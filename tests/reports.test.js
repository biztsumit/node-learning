import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  api, pool, resetDatabase, closeDatabase,
  createUser, createProduct, createAddress, placeOrder
} from "./helpers.js";

beforeEach(resetDatabase);
after(closeDatabase);

// Places a real order, then moves it to a given moment and status
const sale = async (user, items, { at, status = "delivered" }) => {
  const order = (await placeOrder(user, items)).body.data;
  await pool.query("UPDATE orders SET created_at = $1, status = $2 WHERE id = $3", [at, status, order.id]);
  return order;
};

const customer = async () => {
  const user = await createUser();
  await createAddress(user);
  return user;
};

const report = async (admin, path) => (await api().get(`/admin/reports/${path}`).set(admin.auth).expect(200)).body.data;
const refresh = (admin) => api().post("/admin/reports/refresh").set(admin.auth).expect(200);

describe("sales reports", () => {

  it("adds up revenue per Indian day, fills quiet days, and keeps running totals", async () => {
    const admin = await createUser({ role: "admin" });
    const user = await customer();
    const mug = await createProduct({ price: 100, stock: 100 });

    await sale(user, [[mug.id, 1]], { at: "2026-10-01T10:00:00+05:30" });
    // 01:00 in India on Oct 3 is still Oct 2 in UTC: it must count on the 3rd
    await sale(user, [[mug.id, 2]], { at: "2026-10-03T01:00:00+05:30" });
    await sale(user, [[mug.id, 3]], { at: "2026-10-03T18:00:00+05:30", status: "paid" });
    await sale(user, [[mug.id, 9]], { at: "2026-10-03T12:00:00+05:30", status: "cancelled" });  // not a sale
    await sale(user, [[mug.id, 9]], { at: "2026-10-03T12:00:00+05:30", status: "pending" });    // not yet

    await refresh(admin);
    const series = await report(admin, "revenue?from=2026-10-01&to=2026-10-04");
    assert.deepEqual(
      series.points.map((p) => [p.period, p.revenue, p.orders, p.runningRevenue, p.changePercent]),
      [
        ["2026-10-01", 100, 1, 100, null],
        ["2026-10-02", 0, 0, 100, -100],
        ["2026-10-03", 500, 2, 600, null],     // up from 0: no percentage
        ["2026-10-04", 0, 0, 600, -100]
      ]
    );
    assert.equal(series.points[2].movingAverage, 200);   // (100 + 0 + 500) / 3

    const months = await report(admin, "revenue?from=2026-09-15&to=2026-10-31&interval=month");
    assert.deepEqual(months.points.map((p) => [p.period, p.revenue]), [["2026-09-01", 0], ["2026-10-01", 600]]);
  });

  it("is a snapshot until refreshed, and says when it was taken", async () => {
    const admin = await createUser({ role: "admin" });
    const user = await customer();
    const mug = await createProduct({ price: 100 });
    await refresh(admin);
    const before = await report(admin, "summary?from=2026-10-01&to=2026-10-31");

    await sale(user, [[mug.id, 1]], { at: "2026-10-05T12:00:00+05:30" });
    assert.equal((await report(admin, "summary?from=2026-10-01&to=2026-10-31")).revenue.value, 0);   // not yet

    await refresh(admin);
    const after = await report(admin, "summary?from=2026-10-01&to=2026-10-31");
    assert.equal(after.revenue.value, 100);
    assert.ok(new Date(after.dataAsOf) > new Date(before.dataAsOf));
  });

  it("compares a period with the one just before it", async () => {
    const admin = await createUser({ role: "admin" });
    const user = await customer();
    const mug = await createProduct({ price: 100, stock: 100 });
    await sale(user, [[mug.id, 2]], { at: "2026-09-20T12:00:00+05:30" });   // previous 10 days
    await sale(user, [[mug.id, 1]], { at: "2026-10-02T12:00:00+05:30" });
    await sale(user, [[mug.id, 2]], { at: "2026-10-09T12:00:00+05:30" });

    await refresh(admin);
    const summary = await report(admin, "summary?from=2026-10-01&to=2026-10-10");
    assert.deepEqual(summary.previousPeriod, { from: "2026-09-21", to: "2026-09-30" });
    assert.deepEqual(summary.revenue, { value: 300, previous: 0, changePercent: null });

    const longer = await report(admin, "summary?from=2026-09-30&to=2026-10-10");   // previous: Sep 19-29
    assert.deepEqual(longer.revenue, { value: 300, previous: 200, changePercent: 50 });
    assert.deepEqual(longer.averageOrderValue, { value: 150, previous: 200, changePercent: -25 });
    assert.equal(longer.unitsSold.value, 3);
  });

  it("ranks best sellers, sharing ranks on ties", async () => {
    const admin = await createUser({ role: "admin" });
    const user = await customer();
    const lamp = await createProduct({ name: "Lamp", price: 500, stock: 100 });
    const mug = await createProduct({ name: "Mug", price: 100, stock: 100 });
    const pen = await createProduct({ name: "Pen", price: 50, stock: 100 });
    await sale(user, [[lamp.id, 1], [mug.id, 5], [pen.id, 2]], { at: "2026-10-02T12:00:00+05:30" });

    const byRevenue = await report(admin, "top-products?from=2026-10-01&to=2026-10-31");
    assert.deepEqual(
      byRevenue.products.map((p) => [p.rank, p.name, p.revenue, p.revenueSharePercent]),
      [[1, "Lamp", 500, 45.5], [1, "Mug", 500, 45.5], [3, "Pen", 100, 9.1]]
    );
    const byUnits = await report(admin, "top-products?from=2026-10-01&to=2026-10-31&by=units&limit=1");
    assert.deepEqual(byUnits.products.map((p) => [p.rank, p.name, p.unitsSold]), [[1, "Mug", 5]]);
  });

  it("tells new customers from returning ones", async () => {
    const admin = await createUser({ role: "admin" });
    const loyal = await customer();
    const newbie = await customer();
    const mug = await createProduct({ price: 100, stock: 100 });

    await sale(loyal, [[mug.id, 1]], { at: "2026-09-10T12:00:00+05:30" });    // before the range
    await sale(loyal, [[mug.id, 3]], { at: "2026-10-10T12:00:00+05:30" });
    await sale(newbie, [[mug.id, 1]], { at: "2026-10-01T12:00:00+05:30" });
    await sale(newbie, [[mug.id, 1]], { at: "2026-10-05T12:00:00+05:30" });

    const report_ = await report(admin, "customers?from=2026-10-01&to=2026-10-31");
    assert.equal(report_.customers, 2);
    assert.equal(report_.newCustomers, 1);
    assert.equal(report_.returningCustomers, 1);
    assert.equal(report_.orders, 3);
    assert.equal(report_.repeatOrders, 2);                      // loyal's 2nd and newbie's 2nd
    assert.equal(report_.averageDaysBetweenOrders, 17);         // (30 + 4) / 2
    assert.deepEqual(report_.topCustomers.map((c) => [c.rank, c.userId, c.spent]), [[1, loyal.id, 300], [2, newbie.id, 200]]);
  });

  it("is for admins only, and checks the dates", async () => {
    const admin = await createUser({ role: "admin" });
    const user = await createUser();
    await api().get("/admin/reports/summary").set(user.auth).expect(403);
    await api().post("/admin/reports/refresh").set(user.auth).expect(403);

    await api().get("/admin/reports/summary?from=2026-10-10&to=2026-10-01").set(admin.auth).expect(400);
    await api().get("/admin/reports/revenue?from=2020-01-01&to=2026-01-01").set(admin.auth).expect(400);   // too many days
    await api().get("/admin/reports/revenue?from=2020-01-01&to=2026-01-01&interval=month").set(admin.auth).expect(200);
    await api().get("/admin/reports/summary?from=yesterday").set(admin.auth).expect(400);

    const defaults = await report(admin, "summary");
    assert.equal(defaults.to, new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()));
  });
});
