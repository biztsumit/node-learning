import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  api, pool, resetDatabase, closeDatabase, warmUpPool,
  createUser, createProduct, createAddress
} from "./helpers.js";
import { calculateDiscount } from "../src/services/coupon.services.js";
import { buildOrderEmail } from "../src/emails/order-emails.js";

beforeEach(resetDatabase);
after(closeDatabase);

const createCoupon = async (admin, fields) =>
  (await api().post("/admin/coupons").set(admin.auth)
    .send({ code: "WELCOME10", discountType: "percent", discountValue: 10, ...fields })
    .expect(201)).body.data;

// A customer with an address and `amount` rupees of one product in their cart
const shopper = async (amount = 1000) => {
  const user = await createUser();
  await createAddress(user);
  const product = await createProduct({ price: amount, stock: 100 });
  await api().post("/cart/items").set(user.auth).send({ productId: product.id }).expect(200);
  return user;
};

const checkout = (user, couponCode) => api().post("/orders").set(user.auth).send({ couponCode });

describe("the discount maths", () => {

  const coupon = (fields) => ({ discount_type: "percent", discount_value: 10, max_discount: null, ...fields });

  it("rounds down, applies the cap, and always leaves at least ₹1 to pay", () => {
    assert.equal(calculateDiscount(coupon({}), 999), 99);                                    // 99.9 → 99
    assert.equal(calculateDiscount(coupon({ discount_value: 50, max_discount: 300 }), 1000), 300);
    assert.equal(calculateDiscount(coupon({ discount_type: "fixed", discount_value: 200 }), 1000), 200);
    assert.equal(calculateDiscount(coupon({ discount_type: "fixed", discount_value: 500 }), 300), 299);
    assert.equal(calculateDiscount(coupon({ discount_value: 100 }), 250), 249);
  });
});

describe("managing coupons (admin only)", () => {

  it("creates, changes and deletes coupons, checking the rules", async () => {
    const admin = await createUser({ role: "admin" });
    const user = await createUser();
    await api().post("/admin/coupons").set(user.auth).send({ code: "NOPE", discountType: "fixed", discountValue: 5 }).expect(403);

    const coupon = await createCoupon(admin, { code: " summer-sale " });
    assert.equal(coupon.code, "SUMMER-SALE");
    assert.equal(coupon.perUserLimit, 1);

    const post = (fields) => api().post("/admin/coupons").set(admin.auth).send({ code: "OTHER", discountType: "percent", discountValue: 10, ...fields });
    await post({ code: "summer-sale" }).expect(409);                                     // same code
    await post({ discountValue: 150 }).expect(400);                                      // over 100%
    await post({ startsAt: "2026-12-31T00:00:00Z", expiresAt: "2026-01-01T00:00:00Z" }).expect(400);

    const url = `/admin/coupons/${coupon.id}`;
    // A fixed coupon can't keep a percent cap: the rules are checked on the coupon AFTER the change
    await api().patch(url).set(admin.auth).send({ maxDiscount: 100 }).expect(200);
    await api().patch(url).set(admin.auth).send({ discountType: "fixed" }).expect(400);
    const changed = await api().patch(url).set(admin.auth).send({ maxDiscount: null, usageLimit: 50 }).expect(200);
    assert.equal(changed.body.data.maxDiscount, null);
    assert.equal(changed.body.data.usageLimit, 50);

    await api().delete(url).set(admin.auth).expect(200);
    await api().get(url).set(admin.auth).expect(404);
  });
});

describe("using a coupon", () => {

  it("previews the discount on the cart, then applies it at checkout", async () => {
    const admin = await createUser({ role: "admin" });
    await createCoupon(admin, { discountValue: 20, maxDiscount: 150 });
    const user = await shopper(1000);

    const cart = (await api().get("/cart?coupon=welcome10").set(user.auth).expect(200)).body.data;
    assert.equal(cart.discount, 150);   // 20% would be 200, capped at 150
    assert.equal(cart.total, 850);
    assert.equal(cart.coupon.code, "WELCOME10");

    const order = (await checkout(user, "welcome10").expect(201)).body.data;
    assert.equal(order.subtotalAmount, 1000);
    assert.equal(order.discountAmount, 150);
    assert.equal(order.totalAmount, 850);
    assert.equal(order.couponCode, "WELCOME10");

    // The email shows the saving
    const full = (await api().get(`/admin/orders/${order.id}`).set(admin.auth).expect(200)).body.data;
    assert.match(buildOrderEmail("placed", full).text, /Coupon WELCOME10: -₹150/);
  });

  it("explains why a coupon can't be used", async () => {
    const admin = await createUser({ role: "admin" });
    const user = await shopper(400);
    const preview = (code) => api().get(`/cart?coupon=${code}`).set(user.auth);
    const reason = async (code, status) => (await preview(code).expect(status)).body.errors?.[0]?.message;

    await createCoupon(admin, { code: "BIGSPEND", minOrderAmount: 500 });
    await createCoupon(admin, { code: "OLD", expiresAt: "2020-01-01T00:00:00Z" });
    await createCoupon(admin, { code: "SOON", startsAt: "2099-01-01T00:00:00Z" });
    await createCoupon(admin, { code: "OFF", isActive: false });

    assert.equal(await reason("BIGSPEND", 409), "Add ₹100 more to use this coupon (minimum order ₹500)");
    assert.equal(await reason("OLD", 409), "This coupon has expired");
    assert.equal(await reason("SOON", 409), "This coupon isn't active yet");
    await preview("OFF").expect(404);
    await preview("NOSUCHCODE").expect(404);
    await preview("x").expect(400);

    // A failed coupon leaves the cart and stock untouched
    await checkout(user, "OLD").expect(409);
    const cart = await api().get("/cart").set(user.auth).expect(200);
    assert.equal(cart.body.data.items.length, 1);
  });

  it("allows one use per customer, and gives the use back when the order is cancelled", async () => {
    const admin = await createUser({ role: "admin" });
    const coupon = await createCoupon(admin);
    const user = await shopper();
    const timesUsed = async () => (await api().get(`/admin/coupons/${coupon.id}`).set(admin.auth)).body.data.timesUsed;

    const first = (await checkout(user, "WELCOME10").expect(201)).body.data;
    assert.equal(await timesUsed(), 1);

    const product = await createProduct({ stock: 5 });
    await api().post("/cart/items").set(user.auth).send({ productId: product.id }).expect(200);
    const again = await checkout(user, "WELCOME10").expect(409);
    assert.equal(again.body.errors[0].message, "You've already used this coupon");

    // A used coupon can't be deleted, and its limit can't go below what's been used
    await api().delete(`/admin/coupons/${coupon.id}`).set(admin.auth).expect(409);

    await api().post(`/orders/${first.id}/cancel`).set(user.auth).expect(200);
    assert.equal(await timesUsed(), 0);
    await checkout(user, "WELCOME10").expect(201);
    assert.equal(await timesUsed(), 1);

    // The cancelled order still shows the discount it had
    const cancelled = (await api().get(`/orders/${first.id}`).set(user.auth)).body.data;
    assert.equal(cancelled.couponCode, "WELCOME10");
  });

  it("is never used more than its limit, even when many customers check out at once", async () => {
    const admin = await createUser({ role: "admin" });
    const coupon = await createCoupon(admin, { code: "FIRST3", usageLimit: 3 });
    const shoppers = [];
    for (let i = 0; i < 12; i++) {
      shoppers.push(await shopper());
    }

    await warmUpPool();
    const results = await Promise.all(shoppers.map((s) => checkout(s, "FIRST3")));

    assert.deepEqual(results.map((r) => r.status).sort(), [201, 201, 201, ...Array(9).fill(409)]);
    const { rows: [row] } = await pool.query(
      "SELECT times_used, (SELECT COUNT(*)::int FROM coupon_redemptions WHERE coupon_id = $1) AS redemptions FROM coupons WHERE id = $1",
      [coupon.id]
    );
    assert.deepEqual(row, { times_used: 3, redemptions: 3 });

    await api().patch(`/admin/coupons/${coupon.id}`).set(admin.auth).send({ usageLimit: 2 }).expect(409);
  });
});
