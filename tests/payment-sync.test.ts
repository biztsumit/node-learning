import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  api, pool, resetDatabase, closeDatabase,
  createUser, createProduct, createAddress, placeOrder, bodyText, type TestUser
} from "./helpers.ts";
import { reconcilePendingPayments } from "../src/services/payment.services.ts";
import { sentEmails } from "../src/emails/transport.ts";

// ---------- A fake Razorpay: creates orders, and reports the payments we tell it about ----------
const realFetch = globalThis.fetch;
let counter = 0;
let paymentsAtRazorpay: Record<string, Array<{ id: string; amount: number; status: string }>> = {};
let lookups = 0;

before(() => {
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (!u.startsWith("https://api.razorpay.com/")) return realFetch(url, options);

    const lookup = u.match(/\/orders\/([^/]+)\/payments$/);
    if (lookup) {
      lookups++;
      return new Response(JSON.stringify({ entity: "collection", items: paymentsAtRazorpay[lookup[1] ?? ""] ?? [] }));
    }
    const { amount, currency } = JSON.parse(bodyText(options));
    return new Response(JSON.stringify({ id: `order_SYNC${++counter}`, amount, currency, status: "created" }));
  };
});
after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(async () => {
  await resetDatabase();
  paymentsAtRazorpay = {};
  lookups = 0;
});
after(closeDatabase);

// A customer who placed an order and opened Razorpay's window (a payment request exists)
const customerWhoStartedPaying = async (): Promise<{ user: TestUser; orderId: string; razorpayOrderId: string; amount: number }> => {
  const user = await createUser();
  await createAddress(user);
  const product = await createProduct({ price: 500 });
  const order = (await placeOrder(user, [[product.id, 1]])).body.data;
  const payment = (await api().post(`/orders/${order.id}/payment`).set(user.auth).expect(200)).body.data;
  return { user, orderId: order.id, razorpayOrderId: payment.razorpayOrderId, amount: payment.amount };
};

const orderStatus = async (orderId: string): Promise<string> =>
  (await pool.query("SELECT status FROM orders WHERE id = $1", [orderId])).rows[0]?.status;

describe("payment reconciliation", () => {

  it("records a payment the browser never confirmed (the customer asks)", async () => {
    const { user, orderId, razorpayOrderId, amount } = await customerWhoStartedPaying();
    // The customer paid in Razorpay's window, but the confirmation never reached us
    paymentsAtRazorpay[razorpayOrderId] = [{ id: "pay_LOST1", amount, status: "captured" }];

    const res = await api().post(`/orders/${orderId}/payment/sync`).set(user.auth).expect(200);
    assert.equal(res.body.data.status, "paid");
    const { rows: [payment] } = await pool.query("SELECT status, provider_payment_id FROM payments WHERE order_id = $1", [orderId]);
    assert.deepEqual(payment, { status: "paid", provider_payment_id: "pay_LOST1" });
    assert.ok(sentEmails.some((e) => e.subject.startsWith("Payment received")), "the customer is told");

    // Asking again changes nothing
    await api().post(`/orders/${orderId}/payment/sync`).set(user.auth).expect(200);
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM payments WHERE status = 'paid'");
    assert.equal(rows[0].n, 1);
  });

  it("leaves the order pending when nothing was captured", async () => {
    const { user, orderId, razorpayOrderId, amount } = await customerWhoStartedPaying();
    paymentsAtRazorpay[razorpayOrderId] = [{ id: "pay_FAILED", amount, status: "failed" }];

    const res = await api().post(`/orders/${orderId}/payment/sync`).set(user.auth).expect(200);
    assert.equal(res.body.data.status, "pending");
  });

  it("doesn't accept a payment for a different amount", async () => {
    const { user, orderId, razorpayOrderId, amount } = await customerWhoStartedPaying();
    paymentsAtRazorpay[razorpayOrderId] = [{ id: "pay_WRONG", amount: amount - 100, status: "captured" }];

    await api().post(`/orders/${orderId}/payment/sync`).set(user.auth).expect(200);
    assert.equal(await orderStatus(orderId), "pending");
  });

  it("only checks the customer's own orders", async () => {
    const { orderId } = await customerWhoStartedPaying();
    const stranger = await createUser();
    await api().post(`/orders/${orderId}/payment/sync`).set(stranger.auth).expect(404);
  });

  it("is also done by the maintenance job, without asking Razorpay too often", async () => {
    const { orderId, razorpayOrderId, amount } = await customerWhoStartedPaying();

    // Fresh payment requests are left alone: the customer may still be in Razorpay's window
    assert.equal(await reconcilePendingPayments(), 0);
    assert.equal(lookups, 0);

    // Older than 2 minutes, not paid yet: checked once, then not again for 10 minutes
    await pool.query("UPDATE payments SET created_at = NOW() - INTERVAL '5 minutes'");
    assert.equal(await reconcilePendingPayments(), 0);
    assert.equal(await reconcilePendingPayments(), 0);
    assert.equal(lookups, 1);

    // Later it turns out the customer had paid: the next check (10+ minutes on) records it
    paymentsAtRazorpay[razorpayOrderId] = [{ id: "pay_LATE", amount, status: "captured" }];
    await pool.query("UPDATE payments SET checked_at = NOW() - INTERVAL '11 minutes'");
    assert.equal(await reconcilePendingPayments(), 1);
    assert.equal(await orderStatus(orderId), "paid");
  });
});
