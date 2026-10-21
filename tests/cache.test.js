// The catalog cache, switched ON for this file (it's off for every other test file)
import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { catalogCache } from "../src/cache/catalog-cache.js";
import { startCacheInvalidation, stopCacheInvalidation } from "../src/cache/invalidation.js";
import { api, pool, resetDatabase, closeDatabase, createUser, createProduct } from "./helpers.js";

before(async () => {
  catalogCache.configure({ ttlSeconds: 60 });
  await startCacheInvalidation();
});
after(async () => {
  await stopCacheInvalidation();
  catalogCache.configure({ ttlSeconds: 0 });
  await closeDatabase();
});
beforeEach(async () => {
  await resetDatabase();
  catalogCache.clear();
});

const waitFor = async (check, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out waiting");
};

// Creating test data with SQL makes the database NOTIFY a few ms later. Wait until that
// notification has cleared the cache, so it can't land in the middle of a test's reads.
const setUp = async (createData) => {
  const before = catalogCache.stats().clears;
  const result = await createData();
  await waitFor(() => catalogCache.stats().clears > before);
  return result;
};

describe("catalog cache", () => {

  it("serves a repeated read from memory", async () => {
    await setUp(() => createProduct({ name: "Mug" }));

    const first = await api().get("/products").expect(200);
    const second = await api().get("/products").expect(200);

    assert.equal(first.headers["x-cache"], "MISS");
    assert.equal(second.headers["x-cache"], "HIT");
    assert.deepEqual(second.body, first.body);
  });

  it("keeps different searches and pages apart", async () => {
    await setUp(async () => {
      await createProduct({ name: "Mug", price: 100 });
      await createProduct({ name: "Lamp", price: 900 });
    });

    const cheap = await api().get("/products?maxPrice=500").expect(200);
    const all = await api().get("/products").expect(200);
    assert.equal(cheap.headers["x-cache"], "MISS");
    assert.equal(all.headers["x-cache"], "MISS");
    assert.equal(cheap.body.data.length, 1);
    assert.equal(all.body.data.length, 2);

    // Same query, parameters in a different order: same entry
    await api().get("/products?limit=5&page=1").expect(200);
    const reordered = await api().get("/products?page=1&limit=5").expect(200);
    assert.equal(reordered.headers["x-cache"], "HIT");
  });

  it("an admin's change shows up on the very next read", async () => {
    const admin = await createUser({ role: "admin" });
    const product = await setUp(() => createProduct({ name: "Mug", price: 100 }));
    await api().get(`/products/${product.id}`).expect(200);
    assert.equal((await api().get(`/products/${product.id}`)).headers["x-cache"], "HIT");

    await api().put(`/products/${product.id}`).set(admin.auth).send({ name: "Mug", price: 175 }).expect(200);

    const after = await api().get(`/products/${product.id}`).expect(200);
    assert.equal(after.headers["x-cache"], "MISS");
    assert.equal(after.body.data.price, 175);
  });

  it("is cleared by ANY database change, through NOTIFY (e.g. a checkout lowering stock)", async () => {
    const product = await createProduct({ name: "Lamp", stock: 10 });
    await waitFor(async () => (await api().get(`/products/${product.id}`)).headers["x-cache"] === "HIT");

    // Change it behind the API's back, the way checkout, reviews or a manual SQL fix would
    await pool.query("UPDATE products SET stock = 3 WHERE id = $1", [product.id]);

    await waitFor(async () => (await api().get(`/products/${product.id}`)).body.data.stock === 3);
  });

  it("caches categories too, and forgets them when they change", async () => {
    const admin = await createUser({ role: "admin" });
    await api().get("/categories").expect(200);
    assert.equal((await api().get("/categories")).headers["x-cache"], "HIT");

    await api().post("/categories").set(admin.auth).send({ name: "Lamps" }).expect(201);

    const after = await api().get("/categories").expect(200);
    assert.equal(after.headers["x-cache"], "MISS");
    assert.deepEqual(after.body.data.map((c) => c.name), ["Lamps"]);
  });

  it("expires entries after the time limit, even without a change", async () => {
    catalogCache.configure({ ttlSeconds: 1 });
    try {
      await setUp(() => createProduct());
      await api().get("/products").expect(200);
      assert.equal((await api().get("/products")).headers["x-cache"], "HIT");

      await new Promise((r) => setTimeout(r, 1100));
      assert.equal((await api().get("/products")).headers["x-cache"], "MISS");
    } finally {
      catalogCache.configure({ ttlSeconds: 60 });
    }
  });

  it("never stores a result that was loaded while the catalog changed", async () => {
    let finishLoad;
    const slowLoad = catalogCache.wrap("race-test", () => new Promise((r) => { finishLoad = r; }));
    catalogCache.clear();                 // a change arrives while the load is still running
    finishLoad("stale value");
    await slowLoad;

    const next = await catalogCache.wrap("race-test", async () => "fresh value");
    assert.equal(next.value, "fresh value");
    assert.equal(next.hit, false);
  });
});
