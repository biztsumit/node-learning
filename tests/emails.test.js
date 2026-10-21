import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { sentEmails } from "../src/emails/transport.js";
import { buildOrderEmail, escapeHtml, ORDER_EMAIL_TYPES } from "../src/emails/order-emails.js";
import { expireUnpaidOrders, getOrderById } from "../src/services/order.services.js";
import {
  api, pool, resetDatabase, closeDatabase,
  createUser, createProduct, createAddress, placeOrder
} from "./helpers.js";

beforeEach(async () => {
  await resetDatabase();
  sentEmails.length = 0;
});
after(closeDatabase);

const subjects = () => sentEmails.map((e) => e.subject);

const customerWithOrder = async ({ productName = "Ceramic Mug", price = 250, quantity = 2, stock = 10 } = {}) => {
  const user = await createUser({ name: "Riya Sharma" });
  await createAddress(user, { fullName: "Riya Sharma", city: "Pune" });
  const product = await createProduct({ name: productName, price, stock });
  const res = await placeOrder(user, [[product.id, quantity]]);
  return { user, product, res, order: res.body.data };
};

describe("order emails", () => {

  it("tell the customer their order was placed, with items, total and the pay-by date", async () => {
    const { user, order } = await customerWithOrder();

    assert.equal(sentEmails.length, 1);
    const [email] = sentEmails;
    assert.equal(email.to, user.email);
    assert.equal(email.subject, `We've got your order ${order.orderNumber}`);
    assert.match(email.html, /Ceramic Mug × 2/);
    assert.match(email.html, /₹500/);
    assert.match(email.html, /Please pay by/);
    assert.match(email.html, /Pune/);
    assert.match(email.text, /Total: ₹500/);
  });

  it("aren't sent for a checkout that fails and rolls back", async () => {
    const user = await createUser();
    await createAddress(user);
    const lamp = await createProduct({ stock: 3 });
    await api().post("/cart/items").set(user.auth).send({ productId: lamp.id, quantity: 3 }).expect(200);
    await pool.query("UPDATE products SET stock = 1 WHERE id = $1", [lamp.id]);

    await api().post("/orders").set(user.auth).send({}).expect(409);
    assert.deepEqual(sentEmails, []);
  });

  it("follow the order through paid, shipped and delivered", async () => {
    const admin = await createUser({ role: "admin" });
    const { order } = await customerWithOrder();
    for (const status of ["paid", "shipped", "delivered"]) {
      await api().patch(`/admin/orders/${order.id}/status`).set(admin.auth).send({ status }).expect(200);
    }
    assert.deepEqual(subjects(), [
      `We've got your order ${order.orderNumber}`,
      `Payment received for ${order.orderNumber}`,
      `Your order ${order.orderNumber} is on its way`,
      `Delivered: ${order.orderNumber}`
    ]);
  });

  it("explain why an order was cancelled", async () => {
    const byCustomer = await customerWithOrder();
    await api().post(`/orders/${byCustomer.order.id}/cancel`).set(byCustomer.user.auth).expect(200);
    assert.match(sentEmails.at(-1).html, /You cancelled this order/);

    const unpaid = await customerWithOrder();
    await pool.query("UPDATE orders SET created_at = NOW() - INTERVAL '30 days' WHERE id = $1", [unpaid.order.id]);
    await expireUnpaidOrders();
    const email = sentEmails.at(-1);
    assert.equal(email.subject, `Order ${unpaid.order.orderNumber} cancelled`);
    assert.match(email.html, /didn't receive payment in time/);
  });

  it("escape anything typed by people, so it can't inject HTML", async () => {
    const { order } = await customerWithOrder({ productName: `<img src=x onerror="alert(1)">` });
    await pool.query("UPDATE users SET name = '<b>Mallory</b>'");
    const email = buildOrderEmail("paid", await getOrderById(order.id));

    assert.doesNotMatch(email.html, /<img src=x/);
    assert.match(email.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.match(email.html, /Hi &lt;b&gt;Mallory&lt;\/b&gt;/);
    assert.match(email.text, /<b>Mallory<\/b>/);       // plain text needs no escaping
    assert.equal(escapeHtml(`"'&<>`), "&quot;&#39;&amp;&lt;&gt;");
  });

  it("go to EMAIL_REDIRECT_TO instead, when it's set (development safety net)", async () => {
    const { env } = await import("../src/config/env.js");
    env.EMAIL_REDIRECT_TO = "developer@example.com";
    try {
      const { user, order } = await customerWithOrder();
      const [email] = sentEmails;
      assert.equal(email.to, "developer@example.com");
      assert.equal(email.subject, `[to ${user.email}] We've got your order ${order.orderNumber}`);
    } finally {
      delete env.EMAIL_REDIRECT_TO;
    }
  });

  it("have a subject, HTML and text for every type, including a refund note", () => {
    const order = {
      orderNumber: "ORD-7K3M9Q", totalAmount: 1598, createdAt: new Date(), expiresAt: new Date(),
      cancelReason: "admin", refund: { status: "pending", amount: 1598 },
      customer: { name: "Arjun", email: "arjun@example.com" },
      shippingAddress: null,
      items: [{ productName: "Tee", quantity: 2, lineTotal: 1598 }]
    };
    for (const type of ORDER_EMAIL_TYPES) {
      const email = buildOrderEmail(type, order);
      assert.ok(email.subject.includes("ORD-7K3M9Q"), type);
      assert.match(email.html, /<!doctype html>/, type);
      assert.ok(email.text.length > 20, type);
    }
    assert.match(buildOrderEmail("cancelled", order).html, /₹1,598<\/strong> is being refunded/);
    assert.throws(() => buildOrderEmail("bogus", order), /Unknown order email type/);
  });
});
