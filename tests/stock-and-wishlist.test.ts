import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  api, pool, resetDatabase, closeDatabase, warmUpPool,
  createUser, createProduct, createAddress, placeOrder, stockOf, type TestUser
} from "./helpers.ts";

beforeEach(resetDatabase);
after(closeDatabase);

describe("wishlist", () => {

  it("saves each product once, privately, and follows the product", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const mug = await createProduct({ name: "Mug", stock: 0 });
    const pen = await createProduct({ name: "Pen" });

    await api().put(`/wishlist/${mug.id}`).set(alice.auth).expect(200);
    const list = (await api().put(`/wishlist/${mug.id}`).set(alice.auth).expect(200)).body.data;   // again: no change
    assert.equal(list.length, 1);
    assert.equal(list[0].inStock, false);

    await api().put(`/wishlist/${pen.id}`).set(alice.auth).expect(200);
    assert.deepEqual((await api().get("/wishlist").set(bob.auth)).body.data, []);
    await api().delete(`/wishlist/${pen.id}`).set(bob.auth).expect(404);

    await api().put("/wishlist/01a14386-1238-7b41-9618-7ff4c0a7b55d").set(alice.auth).expect(404);
    await api().get("/wishlist").expect(401);

    // A deleted product leaves wishlists by itself (ON DELETE CASCADE)
    await pool.query("DELETE FROM products WHERE id = $1", [pen.id]);
    const after = (await api().get("/wishlist").set(alice.auth)).body.data;
    assert.deepEqual(after.map((i) => i.name), ["Mug"]);
  });
});

// Every movement of a variant, oldest first
const ledger = async (variantId) =>
  (await pool.query(
    "SELECT change, stock_after, reason, order_id, user_id, note FROM stock_movements WHERE variant_id = $1 ORDER BY created_at, id",
    [variantId]
  )).rows;

const variantStock = async (variantId) =>
  (await pool.query("SELECT stock FROM product_variants WHERE id = $1", [variantId])).rows[0].stock;

// The ledger's promise: the balance is the sum of the movements, and each movement
// starts from where the previous one ended
const assertLedgerExplainsStock = async (variantId) => {
  const rows = await ledger(variantId);
  let balance = 0;
  for (const row of rows) {
    balance += row.change;
    assert.equal(row.stock_after, balance, "each stock_after follows from the previous one");
  }
  assert.equal(balance, await variantStock(variantId));
};

describe("stock ledger", () => {

  it("records every change with its reason, order and person", async () => {
    const admin = await createUser({ role: "admin" });
    const customer = await createUser();
    await createAddress(customer);

    const created = await api().post("/products").set(admin.auth).send({ name: "Lamp", price: 900, stock: 10 }).expect(201);
    const product = created.body.data;
    const variantId = product.variants[0].id;

    await api().post("/admin/stock-movements").set(admin.auth)
      .send({ variantId, change: 5, reason: "restock", note: "Delivery #42" }).expect(201);
    const order = (await placeOrder(customer, [[product.id, 3]])).body.data;
    await api().post(`/orders/${order.id}/cancel`).set(customer.auth).expect(200);
    await api().put(`/products/${product.id}`).set(admin.auth).send({ name: "Lamp", stock: 20 }).expect(200);
    await pool.query("UPDATE product_variants SET stock = stock - 1 WHERE id = $1", [variantId]);  // by hand
    await pool.query("UPDATE product_variants SET price = 950 WHERE id = $1", [variantId]);        // not a stock change

    assert.deepEqual(
      (await ledger(variantId)).map((m) => [m.reason, m.change, m.stock_after]),
      [
        ["initial", 10, 10],
        ["restock", 5, 15],
        ["order_placed", -3, 12],
        ["order_cancelled", 3, 15],
        ["correction", 5, 20],
        ["manual", -1, 19]
      ]
    );
    const rows = await ledger(variantId);
    assert.equal(rows[0].user_id, admin.id);
    assert.equal(rows[1].note, "Delivery #42");
    assert.equal(rows[2].order_id, order.id);
    assert.equal(rows[2].user_id, customer.id);
    assert.equal(rows[5].user_id, null);     // the earlier requests' settings didn't leak into this one
    assert.equal(rows[5].note, null);
    await assertLedgerExplainsStock(variantId);

    // The API view, filtered to this order
    const res = await api().get(`/admin/stock-movements?orderId=${order.id}`).set(admin.auth).expect(200);
    assert.deepEqual(res.body.data.map((m) => m.reason), ["order_cancelled", "order_placed"]);
    assert.equal(res.body.data[1].order.orderNumber, order.orderNumber);
    assert.equal(res.body.data[1].by.id, customer.id);
  });

  it("checks adjustments: admins only, sensible signs, never below zero", async () => {
    const admin = await createUser({ role: "admin" });
    const user = await createUser();
    const mug = await createProduct({ stock: 2 });
    const adjust = (who, body) => api().post("/admin/stock-movements").set(who.auth).send({ variantId: mug.variantId, ...body });

    await adjust(user, { change: 5, reason: "restock" }).expect(403);
    await adjust(admin, { change: -5, reason: "restock" }).expect(400);
    await adjust(admin, { change: 1, reason: "damaged" }).expect(400);
    await adjust(admin, { change: 0, reason: "correction" }).expect(400);
    await adjust(admin, { change: -3, reason: "damaged" }).expect(409);
    const ok = await adjust(admin, { change: -2, reason: "damaged", note: "Dropped" }).expect(201);
    assert.equal(ok.body.data.stockAfter, 0);
    assert.equal(ok.body.data.by.id, admin.id);
    assert.equal(await stockOf(mug.id), 0);
  });

  it("stays exact when sales and deliveries happen at the same moment", async () => {
    const admin = await createUser({ role: "admin" });
    const mug = await createProduct({ stock: 10 });   // the trigger logs this as "initial": +10
    const shoppers: TestUser[] = [];
    for (let i = 0; i < 6; i++) {
      const shopper = await createUser();
      await createAddress(shopper);
      await api().post("/cart/items").set(shopper.auth).send({ productId: mug.id }).expect(200);
      shoppers.push(shopper);
    }

    await warmUpPool();
    await Promise.all([
      ...shoppers.map((s) => api().post("/orders").set(s.auth).send({}).expect(201)),
      ...[1, 2, 3, 4, 5, 6].map(() =>
        api().post("/admin/stock-movements").set(admin.auth).send({ variantId: mug.variantId, change: 2, reason: "restock" }).expect(201))
    ]);

    assert.equal(await variantStock(mug.variantId), 10 - 6 + 12);
    await assertLedgerExplainsStock(mug.variantId);
  });
});
