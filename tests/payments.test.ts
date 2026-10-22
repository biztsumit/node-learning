import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  api, pool, resetDatabase, closeDatabase,
  createUser, createProduct, createAddress, placeOrder, hmac, bodyText, requiredEnv
} from "./helpers.ts";

const KEY_SECRET = requiredEnv("RAZORPAY_KEY_SECRET");
const WEBHOOK_SECRET = requiredEnv("RAZORPAY_WEBHOOK_SECRET");

// Pretend to be Razorpay's API. Supertest doesn't use fetch, so only the app's calls are caught.
const realFetch = globalThis.fetch;
let razorpayCalls = 0;
before(() => {
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://api.razorpay.com/")) {
      return realFetch(url, options);
    }
    razorpayCalls++;
    const { amount, currency } = JSON.parse(bodyText(options));
    return new Response(JSON.stringify({ id: `order_TEST${razorpayCalls}`, amount, currency, status: "created" }));
  };
});
after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(resetDatabase);
after(closeDatabase);

// A customer with one pending ₹500 order (2 × ₹250)
const pendingOrder = async () => {
  const user = await createUser();
  await createAddress(user);
  const mug = await createProduct({ price: 250 });
  const order = (await placeOrder(user, [[mug.id, 2]])).body.data;
  return { user, order };
};

const orderStatus = async (id) => (await pool.query("SELECT status FROM orders WHERE id = $1", [id])).rows[0].status;

const sendWebhook = (event, entity, { eventId = `evt_${Math.random()}`, secret = WEBHOOK_SECRET } = {}) => {
  const raw = JSON.stringify({ event, payload: { payment: { entity } } });
  return api()
    .post("/webhooks/razorpay")
    .set("Content-Type", "application/json")
    .set("x-razorpay-signature", hmac(secret, raw))
    .set("x-razorpay-event-id", eventId)
    .send(raw);
};

describe("starting a payment", () => {

  it("asks Razorpay once for the amount in paise, and reuses it on repeat clicks", async () => {
    const { user, order } = await pendingOrder();
    const callsBefore = razorpayCalls;

    const first = await api().post(`/orders/${order.id}/payment`).set(user.auth).expect(200);
    const again = await api().post(`/orders/${order.id}/payment`).set(user.auth).expect(200);

    assert.equal(first.body.data.amount, 50000);
    assert.equal(first.body.data.currency, "INR");
    assert.equal(again.body.data.razorpayOrderId, first.body.data.razorpayOrderId);
    assert.equal(razorpayCalls - callsBefore, 1);
  });

  it("is only possible for your own pending orders", async () => {
    const { user, order } = await pendingOrder();
    const stranger = await createUser();

    await api().post(`/orders/${order.id}/payment`).set(stranger.auth).expect(404);

    await pool.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [order.id]);
    await api().post(`/orders/${order.id}/payment`).set(user.auth).expect(409);
  });
});

describe("confirming from the browser", () => {

  it("rejects a forged signature and accepts a real one, once", async () => {
    const { user, order } = await pendingOrder();
    const razorpayOrderId = (await api().post(`/orders/${order.id}/payment`).set(user.auth)).body.data.razorpayOrderId;
    const razorpayPaymentId = "pay_TEST123";
    const body = {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature: hmac(KEY_SECRET, `${razorpayOrderId}|${razorpayPaymentId}`)
    };

    await api().post(`/orders/${order.id}/payment/verify`).set(user.auth)
      .send({ ...body, razorpaySignature: "a".repeat(64) }).expect(400);
    assert.equal(await orderStatus(order.id), "pending");

    await api().post(`/orders/${order.id}/payment/verify`).set(user.auth).send(body).expect(200);
    await api().post(`/orders/${order.id}/payment/verify`).set(user.auth).send(body).expect(200);
    assert.equal(await orderStatus(order.id), "paid");
  });
});

describe("webhooks", () => {

  it("rejects unsigned or tampered webhooks", async () => {
    await api()
      .post("/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", "nope")
      .send("{}")
      .expect(400);

    await sendWebhook("payment.captured", { id: "pay_X", order_id: "order_X", amount: 1 }, { secret: "wrong" }).expect(400);
  });

  it("marks the order paid, and ignores the same event delivered twice", async () => {
    const { user, order } = await pendingOrder();
    const start = (await api().post(`/orders/${order.id}/payment`).set(user.auth)).body.data;
    const entity = { id: "pay_TESTWEBHOOK", order_id: start.razorpayOrderId, amount: start.amount };

    await sendWebhook("payment.captured", entity, { eventId: "evt_same" }).expect(200);
    await sendWebhook("payment.captured", entity, { eventId: "evt_same" }).expect(200);
    await sendWebhook("order.paid", entity).expect(200);

    assert.equal(await orderStatus(order.id), "paid");
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM webhook_events WHERE event_id = 'evt_same'");
    assert.equal(rows[0].n, 1);
  });

  it("doesn't mark an order paid if the amount is wrong", async () => {
    const { user, order } = await pendingOrder();
    const start = (await api().post(`/orders/${order.id}/payment`).set(user.auth)).body.data;

    await sendWebhook("payment.captured", { id: "pay_CHEAP", order_id: start.razorpayOrderId, amount: 100 }).expect(200);

    assert.equal(await orderStatus(order.id), "pending");
  });
});
