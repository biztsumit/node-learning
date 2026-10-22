import crypto from "node:crypto";
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { deleteOldIdempotencyKeys } from "../src/middlewares/idempotency.middleware.ts";
import {
  api, pool, resetDatabase, closeDatabase, warmUpPool,
  createUser, createProduct, createAddress
} from "./helpers.ts";

beforeEach(resetDatabase);
after(closeDatabase);

const orderCount = async () => (await pool.query("SELECT COUNT(*)::int AS n FROM orders")).rows[0].n;

// A customer with an address and a mug in their cart, ready to check out
const readyToCheckOut = async () => {
  const user = await createUser();
  await createAddress(user);
  const mug = await createProduct({ name: "Mug", price: 250, stock: 10 });
  await api().post("/cart/items").set(user.auth).send({ productId: mug.id, quantity: 2 }).expect(200);
  return { user, mug };
};

const checkout = (user, key, body = {}) =>
  api().post("/orders").set(user.auth).set("Idempotency-Key", key).send(body);

describe("Idempotency-Key", () => {

  it("without a key, a repeated checkout is just a second request", async () => {
    const { user } = await readyToCheckOut();
    await api().post("/orders").set(user.auth).send({}).expect(201);
    await api().post("/orders").set(user.auth).send({}).expect(400);    // cart is empty now
  });

  it("a retried checkout gets the SAME order back, and no second order is placed", async () => {
    const { user } = await readyToCheckOut();
    const key = crypto.randomUUID();

    const first = await checkout(user, key).expect(201);
    const retry = await checkout(user, key).expect(201);

    assert.equal(retry.body.data.id, first.body.data.id);
    assert.deepEqual(retry.body, first.body);
    assert.equal(retry.headers["idempotency-replayed"], "true");
    assert.equal(first.headers["idempotency-replayed"], undefined);
    assert.equal(await orderCount(), 1);
  });

  it("refuses to reuse a key for a different request", async () => {
    const { user } = await readyToCheckOut();
    const key = crypto.randomUUID();
    await checkout(user, key).expect(201);

    const other = await checkout(user, key, { addressId: crypto.randomUUID() }).expect(422);
    assert.match(other.body.message, /already used for a different request/);
  });

  it("keeps keys separate per user", async () => {
    const a = await readyToCheckOut();
    const b = await readyToCheckOut();
    const key = "same-key-for-both";

    const orderA = await checkout(a.user, key).expect(201);
    const orderB = await checkout(b.user, key).expect(201);
    assert.notEqual(orderA.body.data.id, orderB.body.data.id);
  });

  it("handles a double-tap: simultaneous requests with one key place exactly one order", async () => {
    const { user } = await readyToCheckOut();
    const key = crypto.randomUUID();

    await warmUpPool();
    const results = await Promise.all([1, 2, 3, 4].map(() => checkout(user, key)));
    const statuses = results.map((r) => r.status);

    // One placed the order; each of the others was either told "still in progress" or got the replay
    assert.equal(statuses.filter((s) => s === 201).length >= 1, true);
    assert.ok(statuses.every((s) => s === 201 || s === 409), `unexpected statuses ${statuses}`);
    const orderIds = new Set(results.filter((r) => r.status === 201).map((r) => r.body.data.id));
    assert.equal(orderIds.size, 1);
    assert.equal(await orderCount(), 1);
  });

  it("replays error responses too, so a retry doesn't change the answer", async () => {
    const user = await createUser();          // no address, empty cart
    const key = crypto.randomUUID();
    const first = await checkout(user, key).expect(400);
    const retry = await checkout(user, key).expect(400);
    assert.deepEqual(retry.body, first.body);
    assert.equal(retry.headers["idempotency-replayed"], "true");
  });

  it("stops 'add to cart' from adding twice", async () => {
    const user = await createUser();
    const mug = await createProduct({ stock: 10 });
    const key = crypto.randomUUID();
    const add = () => api().post("/cart/items").set(user.auth).set("Idempotency-Key", key).send({ productId: mug.id, quantity: 3 });

    await add().expect(200);
    await add().expect(200);

    const cart = await api().get("/cart").set(user.auth).expect(200);
    assert.equal(cart.body.data.items[0].quantity, 3);
  });

  it("rejects badly formed keys", async () => {
    const { user } = await readyToCheckOut();
    await checkout(user, "short").expect(400);
    await checkout(user, "has spaces in it!").expect(400);
  });

  it("lets a key be used again if its first request died mid-way (server crash)", async () => {
    const { user } = await readyToCheckOut();
    const key = crypto.randomUUID();
    // What a crash leaves behind: a key stuck "in progress" for minutes
    await pool.query(
      `INSERT INTO idempotency_keys (user_id, key, method, path, request_hash, created_at)
       VALUES ($1, $2, 'POST', '/orders', 'x', NOW() - INTERVAL '5 minutes')`,
      [user.id, key]
    );

    await checkout(user, key).expect(201);
    assert.equal(await orderCount(), 1);
  });

  it("forgets keys after 24 hours", async () => {
    const { user } = await readyToCheckOut();
    await checkout(user, crypto.randomUUID()).expect(201);
    await pool.query("UPDATE idempotency_keys SET created_at = NOW() - INTERVAL '25 hours'");

    assert.equal(await deleteOldIdempotencyKeys(), 1);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM idempotency_keys")).rows[0].n, 0);
  });
});
