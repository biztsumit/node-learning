import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  api, pool, resetDatabase, closeDatabase,
  createUser, createProduct, createAddress, stockOf
} from "./helpers.js";
import { buildOrderEmail } from "../src/emails/order-emails.js";

beforeEach(resetDatabase);
after(closeDatabase);

// A T-shirt in sizes M (₹500, 3 left) and L (₹600, 5 left), set up through the admin API
const createTShirt = async (admin) => {
  const shirt = await createProduct({ name: "T-Shirt", price: 500, stock: 3 });
  const variantsUrl = `/products/${shirt.id}/variants`;
  const m = await api().patch(`${variantsUrl}/${shirt.variantId}`).set(admin.auth)
    .send({ options: { size: "M" }, sku: "TEE-M" }).expect(200);
  const l = await api().post(variantsUrl).set(admin.auth)
    .send({ options: { size: "L" }, sku: "TEE-L", price: 600, stock: 5 }).expect(201);
  return { ...shirt, m: m.body.data, l: l.body.data, variantsUrl };
};

describe("managing variants", () => {

  it("keeps the product's price (lowest) and stock (total) in sync", async () => {
    const admin = await createUser({ role: "admin" });
    const shirt = await createTShirt(admin);

    const product = (await api().get(`/products/${shirt.id}`).expect(200)).body.data;
    assert.equal(product.price, 500);
    assert.equal(product.stock, 8);
    assert.equal(product.variantCount, 2);
    assert.deepEqual(product.variants.map((v) => v.label), ["Size: M", "Size: L"]);

    await api().patch(`${shirt.variantsUrl}/${shirt.m.id}`).set(admin.auth).send({ price: 700 }).expect(200);
    await api().delete(`${shirt.variantsUrl}/${shirt.l.id}`).set(admin.auth).expect(200);
    const after = (await api().get(`/products/${shirt.id}`).expect(200)).body.data;
    assert.equal(after.price, 700);
    assert.equal(after.stock, 3);
  });

  it("only lets admins change variants", async () => {
    const user = await createUser();
    const shirt = await createProduct();
    await api().post(`/products/${shirt.id}/variants`).set(user.auth)
      .send({ options: { size: "S" }, price: 100 }).expect(403);
    await api().get(`/products/${shirt.id}/variants`).expect(200);
  });

  it("enforces the rules: same option names, no duplicates, unique SKU, at least one", async () => {
    const admin = await createUser({ role: "admin" });
    const shirt = await createTShirt(admin);
    const add = (body) => api().post(shirt.variantsUrl).set(admin.auth).send({ price: 500, ...body });

    await add({ options: { colour: "Blue" } }).expect(409);              // other variants use "size"
    await add({ options: { size: "M" } }).expect(409);                    // M already exists
    await add({ options: { SIZE: "XL" }, sku: "TEE-M" }).expect(409);     // SKU taken (names are lowercased)
    await add({ options: { size: "XL" } }).expect(201);

    // The first variant of a fresh product has no options: it must get them before others are added
    const mug = await createProduct();
    await api().post(`/products/${mug.id}/variants`).set(admin.auth)
      .send({ options: { size: "Big" }, price: 100 }).expect(409);

    await api().delete(`/products/${mug.id}/variants/${mug.variantId}`).set(admin.auth).expect(409);
    // A variant id from another product is "not found" here
    await api().delete(`/products/${mug.id}/variants/${shirt.l.id}`).set(admin.auth).expect(404);
  });

  it("only accepts price/stock on the product itself when it has one variant", async () => {
    const admin = await createUser({ role: "admin" });
    const mug = await createProduct({ name: "Mug" });
    const shirt = await createTShirt(admin);
    const body = { name: "Renamed", price: 250, stock: 7 };

    await api().put(`/products/${mug.id}`).set(admin.auth).send(body).expect(200);
    assert.equal(await stockOf(mug.id), 7);

    await api().put(`/products/${shirt.id}`).set(admin.auth).send(body).expect(409);
    await api().put(`/products/${shirt.id}`).set(admin.auth).send({ name: "Renamed tee" }).expect(200);
  });
});

describe("buying a variant", () => {

  it("needs a variantId when the product has several", async () => {
    const admin = await createUser({ role: "admin" });
    const user = await createUser();
    const shirt = await createTShirt(admin);

    const res = await api().post("/cart/items").set(user.auth).send({ productId: shirt.id }).expect(400);
    assert.equal(res.body.errors[0].field, "variantId");

    const mug = await createProduct();
    await api().post("/cart/items").set(user.auth).send({ productId: shirt.id, variantId: mug.variantId }).expect(404);
  });

  it("keeps each size on its own cart line, with its own price and stock", async () => {
    const admin = await createUser({ role: "admin" });
    const user = await createUser();
    const shirt = await createTShirt(admin);
    const addItem = (variantId, quantity) =>
      api().post("/cart/items").set(user.auth).send({ productId: shirt.id, variantId, quantity });

    await addItem(shirt.m.id, 2).expect(200);
    await addItem(shirt.l.id, 1).expect(200);
    await addItem(shirt.m.id, 2).expect(409);   // only 3 of M, even though 8 shirts in total

    const cart = (await api().get("/cart").set(user.auth).expect(200)).body.data;
    assert.equal(cart.items.length, 2);
    assert.equal(cart.subtotal, 2 * 500 + 600);

    // Two lines share the product id, so the cart path needs the variant id
    await api().patch(`/cart/items/${shirt.id}`).set(user.auth).send({ quantity: 1 }).expect(409);
    await api().patch(`/cart/items/${shirt.l.id}`).set(user.auth).send({ quantity: 2 }).expect(200);
    await api().delete(`/cart/items/${shirt.m.id}`).set(user.auth).expect(200);
    const after = (await api().get("/cart").set(user.auth).expect(200)).body.data;
    assert.deepEqual(after.items.map((i) => [i.optionsLabel, i.quantity]), [["Size: L", 2]]);
  });

  it("takes and restores stock per variant, and the order remembers the options", async () => {
    const admin = await createUser({ role: "admin" });
    const user = await createUser();
    await createAddress(user);
    const shirt = await createTShirt(admin);
    await api().post("/cart/items").set(user.auth).send({ productId: shirt.id, variantId: shirt.l.id, quantity: 2 }).expect(200);

    const order = (await api().post("/orders").set(user.auth).send({}).expect(201)).body.data;
    const variantStock = async (id) =>
      (await pool.query("SELECT stock FROM product_variants WHERE id = $1", [id])).rows[0].stock;
    assert.equal(await variantStock(shirt.l.id), 3);
    assert.equal(await variantStock(shirt.m.id), 3);
    assert.equal(await stockOf(shirt.id), 6);
    assert.equal(order.totalAmount, 1200);
    assert.deepEqual(order.items[0].options, { size: "L" });
    assert.equal(order.items[0].sku, "TEE-L");

    // Renaming the variant later doesn't rewrite history
    await api().patch(`${shirt.variantsUrl}/${shirt.l.id}`).set(admin.auth).send({ options: { size: "Large" } }).expect(200);
    const saved = (await api().get(`/orders/${order.id}`).set(user.auth).expect(200)).body.data;
    assert.equal(saved.items[0].optionsLabel, "Size: L");

    await api().post(`/orders/${order.id}/cancel`).set(user.auth).expect(200);
    assert.equal(await variantStock(shirt.l.id), 5);
    assert.equal(await stockOf(shirt.id), 8);

    // And the email names the size
    const full = (await api().get(`/admin/orders/${order.id}`).set(admin.auth).expect(200)).body.data;
    const email = buildOrderEmail("placed", { ...full, customer: full.customer ?? { name: "Test", email: user.email } });
    assert.match(email.text, /T-Shirt \(Size: L\) x 2/);
  });
});
