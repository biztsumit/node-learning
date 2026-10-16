import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  api, pool, resetDatabase, closeDatabase, warmUpPool,
  createUser, createProduct, createAddress, placeOrder, setOrderStatus, stockOf
} from "./helpers.js";

beforeEach(resetDatabase);
after(closeDatabase);

describe("cart", () => {

  it("adds the same product to one line and respects stock", async () => {
    const user = await createUser();
    const mug = await createProduct({ price: 250, stock: 3 });

    await api().post("/cart/items").set(user.auth).send({ productId: mug.id, quantity: 1 }).expect(200);
    const res = await api().post("/cart/items").set(user.auth).send({ productId: mug.id, quantity: 2 }).expect(200);

    assert.equal(res.body.data.items.length, 1);
    assert.equal(res.body.data.items[0].quantity, 3);
    assert.equal(res.body.data.subtotal, 750);

    await api().post("/cart/items").set(user.auth).send({ productId: mug.id, quantity: 1 }).expect(409);
  });

  it("keeps carts private", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const mug = await createProduct();
    await api().post("/cart/items").set(alice.auth).send({ productId: mug.id }).expect(200);

    await api().patch(`/cart/items/${mug.id}`).set(bob.auth).send({ quantity: 5 }).expect(404);
    await api().delete(`/cart/items/${mug.id}`).set(bob.auth).expect(404);

    const aliceCart = await api().get("/cart").set(alice.auth).expect(200);
    assert.equal(aliceCart.body.data.items[0].quantity, 1);
  });
});

describe("checkout", () => {

  it("needs a shipping address", async () => {
    const user = await createUser();
    const mug = await createProduct();
    const res = await placeOrder(user, [[mug.id, 1]]);
    assert.equal(res.status, 400);
  });

  it("creates the order, takes stock, empties the cart and snapshots prices", async () => {
    const user = await createUser();
    await createAddress(user, { city: "Jaipur" });
    const mug = await createProduct({ name: "Mug", price: 250, stock: 10 });

    const res = await placeOrder(user, [[mug.id, 2]]);
    assert.equal(res.status, 201);
    assert.equal(res.body.data.totalAmount, 500);
    assert.equal(res.body.data.shippingAddress.city, "Jaipur");
    assert.equal(await stockOf(mug.id), 8);

    const cart = await api().get("/cart").set(user.auth).expect(200);
    assert.equal(cart.body.data.items.length, 0);

    // A later price change must not change the order
    await pool.query("UPDATE products SET price = 999 WHERE id = $1", [mug.id]);
    const order = await api().get(`/orders/${res.body.data.id}`).set(user.auth).expect(200);
    assert.equal(order.body.data.items[0].unitPrice, 250);
  });

  it("saves nothing when an item is out of stock", async () => {
    const user = await createUser();
    await createAddress(user);
    const mug = await createProduct({ stock: 5 });
    const pen = await createProduct({ stock: 2 });
    await api().post("/cart/items").set(user.auth).send({ productId: mug.id, quantity: 1 }).expect(200);
    await api().post("/cart/items").set(user.auth).send({ productId: pen.id, quantity: 2 }).expect(200);
    await pool.query("UPDATE products SET stock = 1 WHERE id = $1", [pen.id]);

    await api().post("/orders").set(user.auth).send({}).expect(409);

    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM orders");
    assert.equal(rows[0].n, 0);
    assert.equal(await stockOf(mug.id), 5);
    const cart = await api().get("/cart").set(user.auth).expect(200);
    assert.equal(cart.body.data.items.length, 2);
  });

  // 15 shoppers, not 5: with only a few, the requests sometimes don't overlap at all,
  // and the test would pass even with the row lock removed (a "flaky" test)
  it("never oversells when many customers check out at the same moment", async () => {
    const vase = await createProduct({ stock: 2 });
    const shoppers = [];
    for (let i = 0; i < 15; i++) {
      const shopper = await createUser();
      await createAddress(shopper);
      await api().post("/cart/items").set(shopper.auth).send({ productId: vase.id }).expect(200);
      shoppers.push(shopper);
    }

    await warmUpPool();
    const results = await Promise.all(shoppers.map((s) => api().post("/orders").set(s.auth).send({})));

    // Exactly 2 sold, everyone else gets a clear "out of stock", nobody gets a server error
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 201, ...Array(13).fill(409)]);
    assert.equal(await stockOf(vase.id), 0);
  });

  it("won't ship to someone else's address", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const aliceAddress = await createAddress(alice);
    const mug = await createProduct();
    await api().post("/cart/items").set(bob.auth).send({ productId: mug.id }).expect(200);

    await api().post("/orders").set(bob.auth).send({ addressId: aliceAddress.id }).expect(404);
  });
});

describe("after checkout", () => {

  it("keeps orders private", async () => {
    const alice = await createUser();
    const bob = await createUser();
    await createAddress(alice);
    const mug = await createProduct();
    const order = (await placeOrder(alice, [[mug.id, 1]])).body.data;

    await api().get(`/orders/${order.id}`).set(bob.auth).expect(404);
    await api().post(`/orders/${order.id}/cancel`).set(bob.auth).expect(404);
  });

  it("restores stock exactly once, even if Cancel is clicked many times", async () => {
    const user = await createUser();
    await createAddress(user);
    const mug = await createProduct({ stock: 10 });
    const order = (await placeOrder(user, [[mug.id, 3]])).body.data;
    assert.equal(await stockOf(mug.id), 7);

    await warmUpPool();
    const clicks = await Promise.all([1, 2, 3].map(() => api().post(`/orders/${order.id}/cancel`).set(user.auth)));

    assert.deepEqual(clicks.map((r) => r.status).sort(), [200, 409, 409]);
    assert.equal(await stockOf(mug.id), 10);
  });

  it("only allows the defined status steps, and only for admins", async () => {
    const user = await createUser();
    const admin = await createUser({ role: "admin" });
    await createAddress(user);
    const mug = await createProduct();
    const order = (await placeOrder(user, [[mug.id, 1]])).body.data;
    const setStatus = (who, status) => api().patch(`/admin/orders/${order.id}/status`).set(who.auth).send({ status });

    await setStatus(user, "paid").expect(403);
    await setStatus(admin, "shipped").expect(409);       // can't skip "paid"
    await setStatus(admin, "paid").expect(200);
    await setStatus(admin, "shipped").expect(200);
    await api().post(`/orders/${order.id}/cancel`).set(user.auth).expect(409);
    await setStatus(admin, "delivered").expect(200);
    await setStatus(admin, "cancelled").expect(409);     // delivered is final
  });

  it("lets admins cancel a paid order and puts the stock back", async () => {
    const user = await createUser();
    const admin = await createUser({ role: "admin" });
    await createAddress(user);
    const mug = await createProduct({ stock: 4 });
    const order = (await placeOrder(user, [[mug.id, 4]])).body.data;
    await setOrderStatus(order.id, "paid");

    await api().patch(`/admin/orders/${order.id}/status`).set(admin.auth).send({ status: "cancelled" }).expect(200);
    assert.equal(await stockOf(mug.id), 4);
  });
});
