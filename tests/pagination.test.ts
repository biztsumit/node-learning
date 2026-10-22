import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  api, pool, resetDatabase, closeDatabase,
  createUser, createProduct, createAddress, placeOrder
} from "./helpers.ts";

beforeEach(resetDatabase);
after(closeDatabase);

// Follows nextCursor from the first page to the last; returns every id seen, in order
const walk = async (url, { limit = 2, auth = {} } = {}) => {
  const join = url.includes("?") ? "&" : "?";
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const res = await api().get(`${url}${join}limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`).set(auth).expect(200);
    ids.push(...res.body.data.map((item) => item.id));
    cursor = res.body.pagination.nextCursor;
  } while (cursor);
  return ids;
};

const everything = async (url, auth = {}) => {
  const join = url.includes("?") ? "&" : "?";
  return (await api().get(`${url}${join}limit=100`).set(auth).expect(200)).body.data.map((item) => item.id);
};

describe("cursor pagination", () => {

  it("gives exactly the full list, page by page, for every sort, even with ties", async () => {
    // Same price, same name, same rating, same created_at: only the id tells them apart
    for (let i = 0; i < 7; i++) {
      await createProduct({ name: i < 4 ? "Mug" : `Pen ${i}`, price: i < 5 ? 100 : 200 });
    }
    await pool.query("UPDATE products SET created_at = '2026-10-21 10:00:00+05:30' WHERE price = 100");

    for (const sort of ["newest", "price_asc", "price_desc", "name_asc", "rating_desc", "relevance"]) {
      assert.deepEqual(await walk(`/products?sort=${sort}`), await everything(`/products?sort=${sort}`), sort);
    }
    assert.deepEqual(await walk("/products?search=mug", { limit: 1 }), await everything("/products?search=mug"));
    assert.deepEqual(await walk("/products?maxPrice=150&sort=price_desc", { limit: 3 }), await everything("/products?maxPrice=150&sort=price_desc"));
  });

  it("tells apart timestamps that differ by microseconds", async () => {
    const first = await createProduct({ name: "First" });
    const second = await createProduct({ name: "Second" });
    // A JavaScript Date would round both to .123 and lose one of them between pages
    await pool.query("UPDATE products SET created_at = '2026-10-21 10:00:00.123456+00' WHERE id = $1", [first.id]);
    await pool.query("UPDATE products SET created_at = '2026-10-21 10:00:00.123789+00' WHERE id = $1", [second.id]);

    assert.deepEqual(await walk("/products?sort=newest", { limit: 1 }), [second.id, first.id]);
  });

  it("never repeats an item when new ones arrive while paging (page numbers do)", async () => {
    for (let i = 0; i < 4; i++) {
      await createProduct({ name: `Old ${i}` });
    }
    const firstPage = (await api().get("/products?limit=2").expect(200)).body;
    await createProduct({ name: "Brand new" });   // lands at the top of "newest first"

    const byCursor = await api().get(`/products?limit=2&cursor=${firstPage.pagination.nextCursor}`).expect(200);
    const byPage = await api().get("/products?limit=2&page=2").expect(200);

    const seen = new Set(firstPage.data.map((p) => p.id));
    assert.equal(byCursor.body.data.filter((p) => seen.has(p.id)).length, 0);
    assert.equal(byPage.body.data.filter((p) => seen.has(p.id)).length, 1);   // the problem cursors solve
    assert.deepEqual(Object.keys(byCursor.body.pagination).sort(), ["limit", "nextCursor"]);   // no slow COUNT
  });

  it("pages orders and the stock ledger too", async () => {
    const admin = await createUser({ role: "admin" });
    const alice = await createUser();
    const bob = await createUser();
    await createAddress(alice);
    await createAddress(bob);
    const mug = await createProduct({ stock: 100 });
    for (let i = 0; i < 3; i++) {
      await placeOrder(alice, [[mug.id, 1]]);
      await placeOrder(bob, [[mug.id, 1]]);
    }

    const aliceOrders = await walk("/orders", { auth: alice.auth });
    assert.equal(aliceOrders.length, 3);
    assert.deepEqual(aliceOrders, await everything("/orders", alice.auth));
    assert.deepEqual(await walk("/admin/orders", { auth: admin.auth, limit: 4 }), await everything("/admin/orders", admin.auth));
    assert.deepEqual(
      await walk(`/admin/stock-movements?productId=${mug.id}`, { auth: admin.auth }),
      await everything(`/admin/stock-movements?productId=${mug.id}`, admin.auth)
    );
  });

  it("rejects cursors that are broken, forged or from another list", async () => {
    await createProduct();
    await createProduct();
    const cursor = (await api().get("/products?sort=price_asc&limit=1").expect(200)).body.pagination.nextCursor;
    const forged = (values) => Buffer.from(JSON.stringify(values)).toString("base64url");

    await api().get("/products?cursor=not-a-cursor").expect(400);
    await api().get(`/products?sort=newest&cursor=${cursor}`).expect(400);         // made for another sort
    await api().get(`/products?sort=price_asc&page=2&cursor=${cursor}`).expect(400);
    await api().get(`/products?sort=price_asc&cursor=${forged(["price_asc", "1); DROP TABLE products;--", "x"])}`).expect(400);
    await api().get(`/products?sort=price_asc&cursor=${forged(["price_asc", 100])}`).expect(400);
    await api().get(`/products?sort=price_asc&cursor=${cursor}`).expect(200);
  });
});
