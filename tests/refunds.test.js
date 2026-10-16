import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { retryPendingRefunds } from "../src/services/refund.services.js";
import {
  api, pool, resetDatabase, closeDatabase, warmUpPool, hmac,
  createUser, createProduct, createAddress, placeOrder
} from "./helpers.js";

// ---------- A fake Razorpay that remembers the refunds it made ----------
const realFetch = globalThis.fetch;
let razorpayRefunds = [];          // refunds "at Razorpay"
let createCalls = 0;
let mode = "ok";                   // "ok" | "down" | "lose-reply"
let counter = 0;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

before(() => {
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (!u.startsWith("https://api.razorpay.com/")) return realFetch(url, options);

    if (u.endsWith("/orders")) {
      const { amount, currency } = JSON.parse(options.body);
      return json({ id: `order_TEST${++counter}`, amount, currency, status: "created" });
    }
    const listMatch = u.match(/\/payments\/([^/]+)\/refunds$/);
    if (listMatch) {
      if (mode === "down") return json({ error: { description: "Service unavailable" } }, 503);
      return json({ items: razorpayRefunds.filter((r) => r.payment_id === listMatch[1]) });
    }
    const createMatch = u.match(/\/payments\/([^/]+)\/refund$/);
    if (createMatch) {
      createCalls++;
      if (mode === "down") return json({ error: { description: "Service unavailable" } }, 503);
      const { amount, receipt } = JSON.parse(options.body);
      const refund = { id: `rfnd_TEST${++counter}`, payment_id: createMatch[1], amount, receipt, status: "pending" };
      razorpayRefunds.push(refund);
      // The refund happened at Razorpay, but the answer never reaches us
      if (mode === "lose-reply") throw new TypeError("fetch failed (connection reset)");
      return json(refund);
    }
    return json({ error: { description: `unexpected ${u}` } }, 404);
  };
});
after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(async () => {
  await resetDatabase();
  razorpayRefunds = [];
  createCalls = 0;
  mode = "ok";
});
after(closeDatabase);

// ---------- Helpers ----------
const sendWebhook = (event, payload) => {
  const raw = JSON.stringify({ event, payload });
  return api()
    .post("/webhooks/razorpay")
    .set("Content-Type", "application/json")
    .set("x-razorpay-signature", hmac(process.env.RAZORPAY_WEBHOOK_SECRET, raw))
    .set("x-razorpay-event-id", `evt_${++counter}`)
    .send(raw);
};

const startPayment = async (user, orderId) =>
  (await api().post(`/orders/${orderId}/payment`).set(user.auth).expect(200)).body.data;

const browserConfirms = (user, orderId, razorpayOrderId, razorpayPaymentId) =>
  api().post(`/orders/${orderId}/payment/verify`).set(user.auth).send({
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature: hmac(process.env.RAZORPAY_KEY_SECRET, `${razorpayOrderId}|${razorpayPaymentId}`)
  });

// A customer whose ₹500 order (2 × ₹250) is paid
const paidOrder = async () => {
  const user = await createUser();
  await createAddress(user);
  const mug = await createProduct({ price: 250, stock: 10 });
  const order = (await placeOrder(user, [[mug.id, 2]])).body.data;
  const start = await startPayment(user, order.id);
  const paymentId = `pay_TEST${++counter}`;
  await browserConfirms(user, order.id, start.razorpayOrderId, paymentId).expect(200);
  return { user, order, start, paymentId };
};

const refundRows = async () => (await pool.query("SELECT * FROM refunds ORDER BY created_at")).rows;
const paymentStatus = async (paymentId) =>
  (await pool.query("SELECT status FROM payments WHERE provider_payment_id = $1", [paymentId])).rows[0].status;
const waitFor = async (check) => {
  for (let i = 0; i < 50; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timed out waiting");
};

describe("automatic refunds", () => {

  it("refunds the customer when an admin cancels a paid order, and tracks it to the end", async () => {
    const admin = await createUser({ role: "admin" });
    const { user, order, paymentId } = await paidOrder();

    const cancelled = await api().patch(`/admin/orders/${order.id}/status`).set(admin.auth).send({ status: "cancelled" }).expect(200);

    assert.equal(createCalls, 1);
    assert.equal(razorpayRefunds[0].payment_id, paymentId);
    assert.equal(razorpayRefunds[0].amount, 50000);                     // paise
    const [refund] = await refundRows();
    assert.equal(razorpayRefunds[0].receipt, refund.id);                 // our id, visible in Razorpay
    assert.deepEqual(
      { status: cancelled.body.data.refund.status, amount: cancelled.body.data.refund.amount },
      { status: "pending", amount: 500 }                                 // rupees, like totalAmount
    );

    // Razorpay tells us it's done
    await sendWebhook("refund.processed", { refund: { entity: { ...razorpayRefunds[0], status: "processed" } } }).expect(200);

    assert.equal(await paymentStatus(paymentId), "refunded");
    const seenByCustomer = await api().get(`/orders/${order.id}`).set(user.auth).expect(200);
    assert.equal(seenByCustomer.body.data.refund.status, "processed");
  });

  it("doesn't refund anything when an unpaid order is cancelled", async () => {
    const admin = await createUser({ role: "admin" });
    const user = await createUser();
    await createAddress(user);
    const mug = await createProduct();
    const order = (await placeOrder(user, [[mug.id, 1]])).body.data;

    await api().patch(`/admin/orders/${order.id}/status`).set(admin.auth).send({ status: "cancelled" }).expect(200);
    assert.equal(createCalls, 0);
    assert.equal((await refundRows()).length, 0);
  });

  it("refunds money that arrives after the order was cancelled", async () => {
    const user = await createUser();
    await createAddress(user);
    const mug = await createProduct({ price: 300 });
    const order = (await placeOrder(user, [[mug.id, 1]])).body.data;
    const start = await startPayment(user, order.id);
    await api().post(`/orders/${order.id}/cancel`).set(user.auth).expect(200);

    const res = await browserConfirms(user, order.id, start.razorpayOrderId, "pay_LATE").expect(409);

    assert.match(res.body.message, /being refunded/);
    assert.equal(createCalls, 1);
    assert.equal(razorpayRefunds[0].amount, 30000);
    assert.equal((await refundRows())[0].reason, "paid_after_cancellation");
  });

  it("refunds only once when the browser and the webhook both report the late payment at the same moment", async () => {
    const user = await createUser();
    await createAddress(user);
    const mug = await createProduct({ price: 300 });
    const order = (await placeOrder(user, [[mug.id, 1]])).body.data;
    const start = await startPayment(user, order.id);
    await api().post(`/orders/${order.id}/cancel`).set(user.auth).expect(200);

    await warmUpPool();
    await Promise.all([
      browserConfirms(user, order.id, start.razorpayOrderId, "pay_TWICE"),
      sendWebhook("payment.captured", { payment: { entity: { id: "pay_TWICE", order_id: start.razorpayOrderId, amount: start.amount } } })
    ]);
    await waitFor(async () => (await refundRows())[0]?.provider_refund_id);

    assert.equal((await refundRows()).length, 1);
    assert.equal(createCalls, 1);
  });

  it("keeps the cancellation and retries the refund later if Razorpay is down", async () => {
    const admin = await createUser({ role: "admin" });
    const { order } = await paidOrder();

    mode = "down";
    const res = await api().patch(`/admin/orders/${order.id}/status`).set(admin.auth).send({ status: "cancelled" }).expect(200);
    assert.equal(res.body.data.status, "cancelled");
    let [refund] = await refundRows();
    assert.equal(refund.provider_refund_id, null);
    assert.equal(refund.attempts, 1);
    assert.match(refund.last_error, /503/);

    mode = "ok";
    assert.equal(await retryPendingRefunds(), 1);
    [refund] = await refundRows();
    assert.match(refund.provider_refund_id, /^rfnd_/);
    assert.equal(razorpayRefunds.length, 1);
  });

  it("never refunds twice when Razorpay did the refund but its reply got lost", async () => {
    const admin = await createUser({ role: "admin" });
    const { order } = await paidOrder();

    mode = "lose-reply";
    await api().patch(`/admin/orders/${order.id}/status`).set(admin.auth).send({ status: "cancelled" }).expect(200);
    assert.equal(razorpayRefunds.length, 1);                              // it DID happen at Razorpay
    assert.equal((await refundRows())[0].provider_refund_id, null);      // ...but we don't know that yet

    mode = "ok";
    await retryPendingRefunds();

    assert.equal(createCalls, 1);                                         // no second refund
    assert.equal(razorpayRefunds.length, 1);
    assert.equal((await refundRows())[0].provider_refund_id, razorpayRefunds[0].id);
  });

  it("ignores webhooks that arrive out of order", async () => {
    const admin = await createUser({ role: "admin" });
    const { order } = await paidOrder();
    await api().patch(`/admin/orders/${order.id}/status`).set(admin.auth).send({ status: "cancelled" }).expect(200);
    const entity = razorpayRefunds[0];

    await sendWebhook("refund.processed", { refund: { entity: { ...entity, status: "processed" } } }).expect(200);
    await sendWebhook("refund.created", { refund: { entity: { ...entity, status: "pending" } } }).expect(200);

    assert.equal((await refundRows())[0].status, "processed");
  });

  it("records a refund that Razorpay couldn't complete", async () => {
    const admin = await createUser({ role: "admin" });
    const { order, paymentId } = await paidOrder();
    await api().patch(`/admin/orders/${order.id}/status`).set(admin.auth).send({ status: "cancelled" }).expect(200);

    await sendWebhook("refund.failed", { refund: { entity: { ...razorpayRefunds[0], status: "failed" } } }).expect(200);

    assert.equal((await refundRows())[0].status, "failed");
    assert.equal(await paymentStatus(paymentId), "paid");                 // money not back yet
  });
});
