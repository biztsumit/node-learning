import crypto from "node:crypto";
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { api, pool, resetDatabase, closeDatabase, createUser, createProduct } from "./helpers.js";

beforeEach(resetDatabase);
after(closeDatabase);

describe("browsing products (public)", () => {

  it("lists products with pagination details", async () => {
    for (let i = 1; i <= 5; i++) {
      await createProduct({ name: `Item ${i}`, price: i * 100 });
    }

    const res = await api().get("/products?limit=2&page=2&sort=price_asc").expect(200);

    assert.deepEqual(res.body.data.map((p) => p.price), [300, 400]);
    const { nextCursor, ...pageInfo } = res.body.pagination;
    assert.deepEqual(pageInfo, { page: 2, limit: 2, total: 5, totalPages: 3 });
    assert.equal(typeof nextCursor, "string");   // there's a page 3
  });

  it("filters by price range, stock and category", async () => {
    const { rows: [category] } = await pool.query("INSERT INTO categories (name) VALUES ('Mugs') RETURNING id");
    await createProduct({ name: "Cheap", price: 50 });
    await createProduct({ name: "Mid", price: 500, stock: 0 });
    await createProduct({ name: "Mug", price: 600, categoryId: category.id });

    const inRange = await api().get("/products?minPrice=100&maxPrice=700").expect(200);
    assert.deepEqual(inRange.body.data.map((p) => p.name).sort(), ["Mid", "Mug"]);

    const inStock = await api().get("/products?minPrice=100&inStock=true").expect(200);
    assert.deepEqual(inStock.body.data.map((p) => p.name), ["Mug"]);

    const byCategory = await api().get(`/products?category=${category.id}`).expect(200);
    assert.equal(byCategory.body.data[0].category.name, "Mugs");
  });

  it("treats % and _ in a search as plain text", async () => {
    await createProduct({ name: "Shirt 50% off" });
    await createProduct({ name: "Shirt 500" });

    const res = await api().get(`/products?search=${encodeURIComponent("50%")}`).expect(200);
    assert.deepEqual(res.body.data.map((p) => p.name), ["Shirt 50% off"]);
  });

  it("rejects bad query options instead of guessing", async () => {
    await api().get("/products?sort=price;DROP TABLE products").expect(400);
    await api().get("/products?minPrice=500&maxPrice=100").expect(400);
    await api().get("/products?limit=1000").expect(400);
    await api().get("/products?inStock=yes").expect(400);
  });

  it("finds a product by slug or id, 404s for unknown ids and 400s for malformed ones", async () => {
    const product = await createProduct({ name: "Blue Mug" });
    await api().get(`/products/slug/${product.slug}`).expect(200);
    await api().get(`/products/${product.id}`).expect(200);
    await api().get(`/products/${crypto.randomUUID()}`).expect(404);   // well-formed, doesn't exist
    await api().get("/products/123").expect(400);                     // old-style number id
    await api().get("/products/not-a-uuid").expect(400);
  });

  it("gives products time-ordered UUIDv7 ids", async () => {
    const first = await createProduct({ name: "First" });
    const second = await createProduct({ name: "Second" });
    assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.ok(second.id > first.id, "a newer UUIDv7 sorts after an older one");
  });
});

describe("searching products", () => {

  const names = async (query) =>
    (await api().get(`/products?search=${encodeURIComponent(query)}`).expect(200)).body.data.map((p) => p.name);

  beforeEach(async () => {
    await createProduct({ name: "Wireless Headphones" });
    await createProduct({ name: "Running Shoes" });
    await createProduct({ name: "Classic Cotton Shirt" });
    await createProduct({ name: "Linen Shirt" });
    await createProduct({ name: "Laptop Stand" });
    const lamp = await createProduct({ name: "Desk Lamp" });
    await pool.query("UPDATE products SET description = 'Warm light, with a cotton shade' WHERE id = $1", [lamp.id]);
  });

  it("finds other forms of a word, in the name or the description", async () => {
    assert.deepEqual(await names("running shoe"), ["Running Shoes"]);
    assert.deepEqual(await names("lamps"), ["Desk Lamp"]);
    assert.deepEqual(await names("shade"), ["Desk Lamp"]);
  });

  it("tolerates typos, without matching everything that's a bit similar", async () => {
    assert.deepEqual(await names("hedphones"), ["Wireless Headphones"]);
    assert.deepEqual(await names("runing shoes"), ["Running Shoes"]);
    assert.deepEqual(await names("lamp"), ["Desk Lamp"]);          // not "Laptop Stand"
  });

  it("matches numbers exactly", async () => {
    await createProduct({ name: "Phone 15" });
    await createProduct({ name: "Phone 16" });
    assert.deepEqual(await names("phone 15"), ["Phone 15"]);
  });

  it("puts the best match first: the name counts more than the description", async () => {
    assert.deepEqual(await names("cotton"), ["Classic Cotton Shirt", "Desk Lamp"]);
    // Choosing another sort still works while searching
    const byName = await api().get("/products?search=cotton&sort=name_asc").expect(200);
    assert.deepEqual(byName.body.data.map((p) => p.name), ["Classic Cotton Shirt", "Desk Lamp"].sort());
  });

  it("accepts sort=relevance without a search (newest first)", async () => {
    const res = await api().get("/products?sort=relevance").expect(200);
    assert.equal(res.body.data[0].name, "Desk Lamp");
  });

  it("understands search-box syntax", async () => {
    assert.deepEqual((await names("shirt -classic")), ["Linen Shirt"]);
    assert.deepEqual((await names("lamp or headphones")).sort(), ["Desk Lamp", "Wireless Headphones"]);
    assert.deepEqual(await names('"cotton shirt"'), ["Classic Cotton Shirt"]);
  });

  it("copes with input that isn't words at all", async () => {
    for (const odd of ["!!!", "'", "&|:*", "-", '"']) {
      await api().get(`/products?search=${encodeURIComponent(odd)}`).expect(200);
    }
  });
});


describe("managing products (admin only)", () => {

  it("lets only admins create products, and generates unique slugs", async () => {
    const customer = await createUser();
    const admin = await createUser({ role: "admin" });
    const body = { name: "Café Mug", price: 349, stock: 5 };

    await api().post("/products").send(body).expect(401);
    await api().post("/products").set(customer.auth).send(body).expect(403);

    const first = await api().post("/products").set(admin.auth).send(body).expect(201);
    const second = await api().post("/products").set(admin.auth).send(body).expect(201);

    assert.equal(first.body.data.slug, "cafe-mug");
    assert.equal(second.body.data.slug, "cafe-mug-2");
  });

  it("validates product fields", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await api()
      .post("/products")
      .set(admin.auth)
      .send({ name: "", price: -5, imageUrl: "javascript:alert(1)" })
      .expect(400);

    assert.deepEqual(res.body.errors.map((e) => e.field).sort(), ["imageUrl", "name", "price"]);
  });

  it("won't delete a category that still has products", async () => {
    const admin = await createUser({ role: "admin" });
    const category = (await api().post("/categories").set(admin.auth).send({ name: "Lamps" }).expect(201)).body.data;
    await createProduct({ name: "Desk Lamp", categoryId: category.id });

    await api().delete(`/categories/${category.id}`).set(admin.auth).expect(409);
  });
});
