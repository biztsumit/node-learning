// Sales reports for admins. Revenue numbers come from the daily_sales materialized view
// (fast, refreshed every few minutes); product and customer reports query orders directly.
//
// Many of these use WINDOW FUNCTIONS: like an aggregate (SUM, AVG, COUNT...), but instead of
// squashing rows into one, every row keeps its place and gets a value computed over a
// "window" of related rows:
//   SUM(revenue) OVER (ORDER BY day)       → running total up to this day
//   LAG(revenue) OVER (ORDER BY day)       → the previous day's value
//   RANK() OVER (ORDER BY revenue DESC)    → 1st, 2nd, 2nd, 4th...
//   ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at)
//                                          → 1 for each customer's first order, 2 for the next...
import pool from "../config/db.js";
import { REPORT_TIME_ZONE, addDays } from "../validators/report.validators.js";

// Orders that count as sales: the money has been received
const SOLD = "o.status IN ('paid', 'shipped', 'delivered')";

// Orders placed from the start of day $from to the end of day $to, Indian time.
// '2026-10-01'::timestamp AT TIME ZONE 'Asia/Kolkata' = "midnight on Oct 1 in India" as a moment.
// Comparing the stored column to two moments (rather than converting every row's created_at)
// lets PostgreSQL use the (status, created_at) index.
const inRange = (fromPlaceholder, toPlaceholder) => `
  o.created_at >= (${fromPlaceholder}::date)::timestamp AT TIME ZONE '${REPORT_TIME_ZONE}'
  AND o.created_at < (${toPlaceholder}::date + 1)::timestamp AT TIME ZONE '${REPORT_TIME_ZONE}'`;

// PostgreSQL sends SUM(bigint) and NUMERIC as text (they can exceed JavaScript's safe range);
// our sums are far below that, so they become normal numbers here
const num = (value) => (value === null ? null : Number(value));

// +25.5 means "25.5% more than the previous period". null when there's nothing to compare with.
const changePercent = (current, previous) =>
  previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;

const dataAsOf = async () =>
  (await pool.query("SELECT refreshed_at FROM report_refreshes WHERE name = 'daily_sales'")).rows[0]?.refreshed_at ?? null;

// Re-runs the view's query and swaps in the new result. CONCURRENTLY: dashboards can keep
// reading the old numbers while it runs (it needs the unique index on day).
export const refreshSalesReport = async () => {
  await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY daily_sales");
  const { rows } = await pool.query(
    `INSERT INTO report_refreshes (name, refreshed_at) VALUES ('daily_sales', NOW())
     ON CONFLICT (name) DO UPDATE SET refreshed_at = EXCLUDED.refreshed_at
     RETURNING refreshed_at`
  );
  return rows[0].refreshed_at;
};

// ---------- Summary: this period vs the one before ----------

export const getSummary = async ({ from, to }) => {
  // The previous period has the same length and ends the day before this one starts
  const length = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  const previous = { from: addDays(from, -length), to: addDays(from, -1) };

  // One pass over both periods: FILTER (WHERE ...) makes each SUM count only its own days
  const { rows: [row] } = await pool.query(
    `SELECT
       SUM(revenue) FILTER (WHERE day >= $1) AS revenue,
       SUM(orders) FILTER (WHERE day >= $1) AS orders,
       SUM(units) FILTER (WHERE day >= $1) AS units,
       SUM(discounts) FILTER (WHERE day >= $1) AS discounts,
       SUM(revenue) FILTER (WHERE day < $1) AS previous_revenue,
       SUM(orders) FILTER (WHERE day < $1) AS previous_orders,
       SUM(units) FILTER (WHERE day < $1) AS previous_units,
       SUM(discounts) FILTER (WHERE day < $1) AS previous_discounts
     FROM daily_sales
     WHERE day BETWEEN $3 AND $2`,
    [from, to, previous.from]
  );

  const metric = (current, before) => ({
    value: num(current) ?? 0,
    previous: num(before) ?? 0,
    changePercent: changePercent(num(current) ?? 0, num(before) ?? 0)
  });
  const aov = (revenue, orders) => (num(orders) > 0 ? Math.round(num(revenue) / num(orders)) : 0);

  return {
    from,
    to,
    previousPeriod: previous,
    revenue: metric(row.revenue, row.previous_revenue),
    orders: metric(row.orders, row.previous_orders),
    unitsSold: metric(row.units, row.previous_units),
    discounts: metric(row.discounts, row.previous_discounts),
    averageOrderValue: metric(aov(row.revenue, row.orders), aov(row.previous_revenue, row.previous_orders)),
    dataAsOf: await dataAsOf()
  };
};

// ---------- Revenue over time ----------

export const getRevenueSeries = async ({ from, to, interval }) => {
  // generate_series makes EVERY period in the range, and the LEFT JOIN fills days without
  // sales with 0. Otherwise a chart would silently skip the quiet days.
  // Window functions then work across the finished list of periods, in date order.
  const { rows } = await pool.query(
    `WITH periods AS (
       SELECT generate_series(
         date_trunc($3, $1::date::timestamp),
         $2::date::timestamp,
         ('1 ' || $3)::interval
       )::date AS period
     ),
     sales AS (
       SELECT date_trunc($3, day::timestamp)::date AS period,
              SUM(revenue) AS revenue, SUM(orders) AS orders, SUM(units) AS units
       FROM daily_sales
       WHERE day BETWEEN $1 AND $2
       GROUP BY 1
     ),
     filled AS (
       SELECT p.period, COALESCE(s.revenue, 0) AS revenue, COALESCE(s.orders, 0) AS orders, COALESCE(s.units, 0) AS units
       FROM periods p LEFT JOIN sales s USING (period)
     )
     SELECT
       period::text AS period,                    -- "2026-10-22": as text, so no time zone can shift it
       revenue, orders, units,
       SUM(revenue) OVER (ORDER BY period) AS running_revenue,
       LAG(revenue) OVER (ORDER BY period) AS previous_revenue,
       -- The average of this period and the 6 before it: smooths out busy and quiet days
       ROUND(AVG(revenue) OVER (ORDER BY period ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)) AS moving_average
     FROM filled
     ORDER BY period`,
    [from, to, interval]
  );

  return {
    from,
    to,
    interval,
    // week = Monday to Sunday; month = calendar month. The first/last period may be partly outside the range.
    points: rows.map((row) => ({
      period: row.period,
      revenue: num(row.revenue),
      orders: num(row.orders),
      unitsSold: num(row.units),
      runningRevenue: num(row.running_revenue),
      changePercent: row.previous_revenue === null ? null : changePercent(num(row.revenue), num(row.previous_revenue)),
      movingAverage: num(row.moving_average)
    })),
    dataAsOf: await dataAsOf()
  };
};

// ---------- Best-selling products ----------

// by: "revenue" or "units" (a fixed list: column names can't be $1 placeholders)
const RANK_BY = { revenue: "revenue", units: "units" };

export const getTopProducts = async ({ from, to, by, limit }) => {
  const { rows } = await pool.query(
    `WITH sold AS (
       SELECT
         oi.product_id,
         -- Today's name if the product still exists, else the name it had when sold
         COALESCE(p.name, MIN(oi.product_name)) AS name,
         SUM(oi.quantity) AS units,
         SUM(oi.line_total) AS revenue,
         COUNT(DISTINCT o.id) AS orders
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE ${SOLD} AND ${inRange("$1", "$2")}
       -- Deleted products have no id any more: keep them apart by their old name
       GROUP BY oi.product_id, p.name, CASE WHEN oi.product_id IS NULL THEN oi.product_name END
     )
     SELECT *,
       -- Ties share a rank (1, 2, 2, 4), unlike ROW_NUMBER (1, 2, 3, 4)
       RANK() OVER (ORDER BY ${RANK_BY[by]} DESC) AS rank,
       -- OVER () with nothing inside = the window is ALL rows: each product's share of the total
       ROUND(100.0 * revenue / NULLIF(SUM(revenue) OVER (), 0), 1) AS revenue_share
     FROM sold
     ORDER BY ${RANK_BY[by]} DESC, name, product_id
     LIMIT $3`,
    [from, to, limit]
  );

  return {
    from,
    to,
    by,
    products: rows.map((row) => ({
      rank: num(row.rank),
      productId: row.product_id,
      name: row.name,
      unitsSold: num(row.units),
      // Before order-level coupon discounts (those apply to the whole order, not one product)
      revenue: num(row.revenue),
      revenueSharePercent: num(row.revenue_share),
      orders: num(row.orders)
    }))
  };
};

// ---------- Customers: new vs returning ----------

export const getCustomerReport = async ({ from, to, limit }) => {
  // Window functions run AFTER the WHERE clause. To know if an October order was someone's
  // FIRST EVER order, the numbering must see all their orders, so it happens in a CTE over
  // every sale, and only the outer query keeps the ones in the range.
  const statsQuery = pool.query(
    `WITH numbered AS (
       SELECT o.id, o.user_id, o.created_at,
         ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.created_at, o.id) AS nth_order,
         LAG(o.created_at) OVER (PARTITION BY o.user_id ORDER BY o.created_at, o.id) AS previous_order_at
       FROM orders o
       WHERE ${SOLD}
     )
     SELECT
       COUNT(DISTINCT user_id) AS customers,
       COUNT(DISTINCT user_id) FILTER (WHERE nth_order = 1) AS new_customers,
       COUNT(*) AS orders,
       COUNT(*) FILTER (WHERE nth_order > 1) AS repeat_orders,
       ROUND(AVG(EXTRACT(EPOCH FROM created_at - previous_order_at) / 86400)
             FILTER (WHERE previous_order_at IS NOT NULL), 1) AS average_days_between_orders
     FROM numbered o
     WHERE ${inRange("$1", "$2")}`,
    [from, to]
  );

  // Window functions also run AFTER GROUP BY, so they can rank the groups' totals
  const topQuery = pool.query(
    `SELECT u.id, u.name, u.email,
       COUNT(*) AS orders,
       SUM(o.total_amount) AS spent,
       DENSE_RANK() OVER (ORDER BY SUM(o.total_amount) DESC) AS rank
     FROM orders o
     JOIN users u ON u.id = o.user_id
     WHERE ${SOLD} AND ${inRange("$1", "$2")}
     GROUP BY u.id
     ORDER BY spent DESC, u.id
     LIMIT $3`,
    [from, to, limit]
  );

  const [{ rows: [stats] }, { rows: top }] = await Promise.all([statsQuery, topQuery]);
  const customers = num(stats.customers);
  const newCustomers = num(stats.new_customers);

  return {
    from,
    to,
    customers,
    // First order ever was in this range
    newCustomers,
    // Had ordered before this range, and came back
    returningCustomers: customers - newCustomers,
    returningPercent: customers > 0 ? Math.round(((customers - newCustomers) / customers) * 1000) / 10 : null,
    orders: num(stats.orders),
    repeatOrders: num(stats.repeat_orders),
    averageDaysBetweenOrders: num(stats.average_days_between_orders),
    topCustomers: top.map((row) => ({
      rank: num(row.rank),
      userId: row.id,
      name: row.name,
      email: row.email,
      orders: num(row.orders),
      spent: num(row.spent)
    }))
  };
};
