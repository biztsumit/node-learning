import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { env } from "../src/config/env.ts";
import { expireUnpaidOrders } from "../src/services/order.services.ts";
import {
  api, pool, resetDatabase, closeDatabase, warmUpPool, hmac,
  createUser, createProduct, createAddress, placeOrder, setOrderStatus, stockOf, bodyText, requiredEnv
} from "./helpers.ts";

// Pretend to be Razorpay (only needed for the "paid after expiry" test)
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://api.razorpay.com/")) return realFetch(url, options);
    const { amount, currency } = JSON.parse(bodyText(options));
    return new Response(JSON.stringify({ id: `order_TEST${Date.now()}${Math.random()}`, amount, currency, status: "created" }));
  };
});
after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(resetDatabase);
after(closeDatabase);

// Instead of waiting days, make the order look older. All ages are relative to the
// configured timeout, so these tests stay right whatever ORDER_PAYMENT_TIMEOUT_MINUTES is.
const TIMEOUT = env.ORDER_PAYMENT_TIMEOUT_MINUTES;
const ageOrder = (orderId, minutes) =>
  pool.query("UPDATE orders SET created_at = NOW() - make_interval(mins => $2) WHERE id = $1", [orderId, minutes]);

const orderRow = async (orderId) =>
  (await pool.query("SELECT status, cancel_reason FROM orders WHERE id = $1", [orderId])).rows[0];

// A customer with a pending order for `quantity` lamps (stock starts at 10)
const pendingOrder = async (quantity = 2) => {
  const user = await createUser();
  await createAddress(user);
  const lamp = await createProduct({ name: "Lamp", price: 500, stock: 10 });
  const order = (await placeOrder(user, [[lamp.id, quantity]])).body.data;
  return { user, lamp, order };
};

describe("expiring unpaid orders", () => {

  it("gives customers 3 days to pay by default", () => {
    assert.equal(TIMEOUT, 3 * 24 * 60);
  });

  it("tells the customer when a pending order must be paid by", async () => {
    const { order } = await pendingOrder();
    // .getTime(): TypeScript doesn't do arithmetic on Date objects, only on numbers
    const minutesLeft = (new Date(order.expiresAt).getTime() - new Date(order.createdAt).getTime()) / 60000;
    assert.equal(minutesLeft, TIMEOUT);
  });

  it("cancels pending orders older than the timeout and releases their stock", async () => {
    const { user, lamp, order } = await pendingOrder(3);
    assert.equal(await stockOf(lamp.id), 7);

    await ageOrder(order.id, TIMEOUT + 1);
    const cancelled = await expireUnpaidOrders();

    assert.deepEqual(cancelled, [order.id]);
    assert.equal(await stockOf(lamp.id), 10);
    const res = await api().get(`/orders/${order.id}`).set(user.auth).expect(200);
    assert.equal(res.body.data.status, "cancelled");
    assert.equal(res.body.data.cancelReason, "payment_timeout");
    assert.equal(res.body.data.expiresAt, null);
  });

  it("leaves recent pending orders and paid orders alone", async () => {
    const recent = await pendingOrder();
    await ageOrder(recent.order.id, TIMEOUT - 1);

    const paid = await pendingOrder();
    await setOrderStatus(paid.order.id, "paid");
    await ageOrder(paid.order.id, TIMEOUT * 20);

    assert.deepEqual(await expireUnpaidOrders(), []);
    assert.equal((await orderRow(recent.order.id)).status, "pending");
    assert.equal((await orderRow(paid.order.id)).status, "paid");
  });

  it("is safe when several servers run it at the same moment", async () => {
    const lamp = await createProduct({ name: "Lamp", stock: 50 });
    const orderIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const user = await createUser();
      await createAddress(user);
      const order = (await placeOrder(user, [[lamp.id, 2]])).body.data;
      await ageOrder(order.id, TIMEOUT + 15);
      orderIds.push(order.id);
    }
    assert.equal(await stockOf(lamp.id), 38);

    await warmUpPool();
    const runs = await Promise.all([expireUnpaidOrders(), expireUnpaidOrders(), expireUnpaidOrders()]);

    // Every order cancelled exactly once, by exactly one of the runs
    const all = runs.flat();
    assert.equal(all.length, 6);
    assert.deepEqual([...new Set(all)].sort(), [...orderIds].sort());
    assert.equal(await stockOf(lamp.id), 50);
  });

  it("refuses to start a payment once the time is up, even before the job runs", async () => {
    const { user, order } = await pendingOrder();
    await ageOrder(order.id, TIMEOUT + 1);

    const res = await api().post(`/orders/${order.id}/payment`).set(user.auth).expect(409);
    assert.match(res.body.message, /time to pay .* has run out/);
  });

  it("flags a refund if the money arrives after the order expired", async () => {
    const { user, order } = await pendingOrder();
    const start = (await api().post(`/orders/${order.id}/payment`).set(user.auth).expect(200)).body.data;

    await ageOrder(order.id, TIMEOUT + 1);
    await expireUnpaidOrders();

    // The customer finishes paying on Razorpay's page just after the cut-off
    const razorpayPaymentId = "pay_LATE123";
    const res = await api().post(`/orders/${order.id}/payment/verify`).set(user.auth).send({
      razorpayOrderId: start.razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature: hmac(requiredEnv("RAZORPAY_KEY_SECRET"), `${start.razorpayOrderId}|${razorpayPaymentId}`)
    });

    assert.equal(res.status, 409);
    assert.match(res.body.message, /refunded/);
    assert.equal((await orderRow(order.id)).status, "cancelled");
  });

  it("records who cancelled: the customer or an admin", async () => {
    const admin = await createUser({ role: "admin" });
    const a = await pendingOrder();
    const b = await pendingOrder();

    await api().post(`/orders/${a.order.id}/cancel`).set(a.user.auth).expect(200);
    await api().patch(`/admin/orders/${b.order.id}/status`).set(admin.auth).send({ status: "cancelled" }).expect(200);

    assert.equal((await orderRow(a.order.id)).cancel_reason, "customer");
    assert.equal((await orderRow(b.order.id)).cancel_reason, "admin");
  });
});
