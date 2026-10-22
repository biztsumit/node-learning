import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  api, pool, resetDatabase, closeDatabase, warmUpPool,
  createUser, createProduct, createAddress, placeOrder
} from "./helpers.js";
import { runWithContext } from "../src/context/request-context.ts";
import { expireUnpaidOrders } from "../src/services/order.services.ts";

beforeEach(resetDatabase);
after(closeDatabase);

const entriesFor = async (table, recordId) =>
  (await pool.query(
    "SELECT action, changes, actor_id, request_id, source FROM audit_log WHERE table_name = $1 AND record_id = $2 ORDER BY created_at, id",
    [table, recordId]
  )).rows;

describe("audit log", () => {

  it("records who changed a price, from what to what", async () => {
    const admin = await createUser({ role: "admin" });
    const shopper = await createUser();
    await createAddress(shopper);
    const mug = await createProduct({ price: 100 });

    await api().patch(`/products/${mug.id}/variants/${mug.variantId}`).set(admin.auth).send({ price: 150 }).expect(200);
    await placeOrder(shopper, [[mug.id, 1]]);   // changes stock only: that's the stock ledger's job

    const entries = await entriesFor("product_variants", mug.variantId);
    const updates = entries.filter((e) => e.action === "update");
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].changes, { price: [100, 150] });
    assert.equal(updates[0].actor_id, admin.id);
    assert.equal(updates[0].source, "api");
    assert.ok(updates[0].request_id);
  });

  it("tells customers, background jobs and hand-typed SQL apart", async () => {
    const shopper = await createUser();
    await createAddress(shopper);
    const mug = await createProduct({ stock: 10 });
    const mine = (await placeOrder(shopper, [[mug.id, 1]])).body.data;
    const forgotten = (await placeOrder(shopper, [[mug.id, 1]])).body.data;

    await api().post(`/orders/${mine.id}/cancel`).set(shopper.auth).expect(200);
    const [byCustomer] = await entriesFor("orders", mine.id);
    assert.deepEqual(byCustomer.changes.status, ["pending", "cancelled"]);
    assert.equal(byCustomer.actor_id, shopper.id);

    await pool.query("UPDATE orders SET created_at = NOW() - interval '30 days' WHERE id = $1", [forgotten.id]);
    await runWithContext({ source: "job:maintenance" }, () => expireUnpaidOrders());
    const [handTyped, statusChange] = await entriesFor("orders", forgotten.id);
    assert.deepEqual(Object.keys(handTyped.changes), ["created_at"]);
    assert.equal(handTyped.source, "database");                  // our UPDATE above, typed by hand
    assert.equal(statusChange.source, "job:maintenance");
    assert.equal(statusChange.actor_id, null);
  });

  it("logs that a password changed, never the password hash", async () => {
    const user = await createUser({ password: "secret123" });
    await api().post("/auth/change-password").set(user.auth)
      .send({ currentPassword: "secret123", newPassword: "evenmoresecret456" }).expect(200);

    const [entry] = await entriesFor("users", user.id);
    assert.deepEqual(entry.changes, { password_hash: ["[redacted]", "[redacted]"] });
    assert.equal(entry.actor_id, user.id);
    const { rows: [{ hash }] } = await pool.query("SELECT password_hash AS hash FROM users WHERE id = $1", [user.id]);
    const { rows: [{ n }] } = await pool.query("SELECT COUNT(*)::int AS n FROM audit_log WHERE changes::text LIKE '%' || $1 || '%'", [hash]);
    assert.equal(n, 0);
  });

  it("can't be edited or deleted, even directly in the database", async () => {
    const admin = await createUser({ role: "admin" });
    await api().post("/categories").set(admin.auth).send({ name: "Mugs" }).expect(201);

    await assert.rejects(pool.query("UPDATE audit_log SET actor_id = NULL"), /append-only/);
    await assert.rejects(pool.query("DELETE FROM audit_log"), /append-only/);
    const { rows } = await pool.query("SELECT action, changes->>'name' AS name, actor_id FROM audit_log WHERE table_name = 'categories'");
    assert.deepEqual(rows, [{ action: "insert", name: "Mugs", actor_id: admin.id }]);
  });

  it("keeps each request's actor separate, even when they run at the same time", async () => {
    const admins = [];
    for (let i = 0; i < 6; i++) {
      admins.push(await createUser({ role: "admin" }));
    }
    const products = [];
    for (let i = 0; i < 6; i++) {
      products.push(await createProduct({ price: 100 }));
    }

    await warmUpPool();
    await Promise.all(admins.map((admin, i) =>
      api().patch(`/products/${products[i].id}/variants/${products[i].variantId}`).set(admin.auth).send({ price: 200 + i }).expect(200)));

    for (let i = 0; i < 6; i++) {
      const update = (await entriesFor("product_variants", products[i].variantId)).find((e) => e.action === "update");
      assert.equal(update.actor_id, admins[i].id, `change ${i} credited to the wrong admin`);
    }
  });

  it("shows entries to admins only, filtered and paged", async () => {
    const admin = await createUser({ role: "admin" });
    const user = await createUser();
    const mug = await createProduct({ price: 100 });
    for (const price of [110, 120, 130]) {
      await api().patch(`/products/${mug.id}/variants/${mug.variantId}`).set(admin.auth).send({ price }).expect(200);
    }

    await api().get("/admin/audit-log").set(user.auth).expect(403);
    const page = await api().get(`/admin/audit-log?table=product_variants&recordId=${mug.variantId}&action=update&limit=2`).set(admin.auth).expect(200);
    assert.deepEqual(page.body.data.map((e) => e.changes.price), [[120, 130], [110, 120]]);
    assert.equal(page.body.data[0].actor.id, admin.id);
    const next = await api().get(`/admin/audit-log?table=product_variants&recordId=${mug.variantId}&action=update&limit=2&cursor=${page.body.pagination.nextCursor}`).set(admin.auth).expect(200);
    assert.deepEqual(next.body.data.map((e) => e.changes.price), [[100, 110]]);
  });
});

describe("changing roles", () => {

  it("promotes and demotes, with an audit entry, but never yourself", async () => {
    const admin = await createUser({ role: "admin" });
    const user = await createUser();

    await api().patch(`/users/${user.id}/role`).set(user.auth).send({ role: "admin" }).expect(403);
    await api().patch(`/users/${admin.id}/role`).set(admin.auth).send({ role: "user" }).expect(409);
    const res = await api().patch(`/users/${user.id}/role`).set(admin.auth).send({ role: "admin" }).expect(200);
    assert.equal(res.body.data.role, "admin");
    await api().get("/admin/audit-log").set(user.auth).expect(200);   // effective right away

    const [entry] = await entriesFor("users", user.id);
    assert.deepEqual(entry.changes, { role: ["user", "admin"] });
    assert.equal(entry.actor_id, admin.id);
  });

  it("never leaves the shop without an admin, even if two admins demote each other at once", async () => {
    const alice = await createUser({ role: "admin" });
    const bob = await createUser({ role: "admin" });

    await warmUpPool();
    const results = await Promise.all([
      api().patch(`/users/${bob.id}/role`).set(alice.auth).send({ role: "user" }),
      api().patch(`/users/${alice.id}/role`).set(bob.auth).send({ role: "user" })
    ]);

    const statuses = results.map((r) => r.status).sort();
    // One wins. The other is refused: either it's now the last admin (409),
    // or its sender was just demoted and isn't an admin any more (403)
    assert.equal(statuses[0], 200);
    assert.ok([403, 409].includes(statuses[1]));
    const { rows: [{ n }] } = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'");
    assert.equal(n, 1);
  });
});
