-- Sales reports for the admin dashboard.
--
-- A MATERIALIZED VIEW is a query whose RESULT is saved like a table. Reading it is instant
-- (one small row per day), instead of adding up every order on every dashboard load.
-- The price: it's a snapshot. It changes only when refreshed (our job does that every
-- 10 minutes, and admins can ask for it), so the API reports when it was last refreshed.

-- Money counts once it's received: paid, shipped or delivered. Pending orders aren't sales yet,
-- and cancelled ones (refunded if they were paid) aren't sales at all.
--
-- Days are Indian days: AT TIME ZONE 'Asia/Kolkata' turns the stored moment into IST local
-- time first. An order at 01:00 IST on the 14th is still 19:30 on the 13th in UTC, and
-- grouping by the UTC date would put it on the wrong day.
CREATE MATERIALIZED VIEW daily_sales AS
SELECT
  (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
  COUNT(*)::int AS orders,
  SUM(o.total_amount)::bigint AS revenue,          -- what customers paid
  SUM(o.subtotal_amount)::bigint AS gross_sales,   -- before discounts
  SUM(o.discount_amount)::bigint AS discounts,
  SUM(items.units)::bigint AS units
FROM orders o
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(oi.quantity), 0) AS units FROM order_items oi WHERE oi.order_id = o.id
) items
WHERE o.status IN ('paid', 'shipped', 'delivered')
GROUP BY 1;

-- REFRESH ... CONCURRENTLY (which doesn't block readers) needs a unique index to match old and
-- new rows. It also makes "the days between X and Y" a quick index lookup.
CREATE UNIQUE INDEX daily_sales_day_idx ON daily_sales (day);

-- When each report was last refreshed (shown as "data as of ...")
CREATE TABLE report_refreshes (
  name VARCHAR(50) PRIMARY KEY,
  refreshed_at TIMESTAMPTZ NOT NULL
);
INSERT INTO report_refreshes (name, refreshed_at) VALUES ('daily_sales', NOW());

-- The live reports (top products, customers) filter orders by status and date
CREATE INDEX orders_status_created_idx ON orders (status, created_at);
