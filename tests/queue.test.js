// The REAL job queue (pg-boss) running against the test database
import crypto from "node:crypto";
import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { enqueue, startQueue, stopQueue } from "../src/jobs/queue.ts";
import { sentEmails } from "../src/emails/transport.ts";
import { withTransaction } from "../src/db/transaction.ts";
import {
  api, pool, resetDatabase, closeDatabase,
  createUser, createProduct, createAddress, placeOrder, setVariantFields
} from "./helpers.js";

// Fake Cloudinary delete API that can fail on demand
const realFetch = globalThis.fetch;
let deleteCalls = [];
let failNextDeletes = 0;

let boss;
before(async () => {
  globalThis.fetch = async (url, options) => {
    if (!String(url).includes("api.cloudinary.com")) return realFetch(url, options);
    const publicId = new URLSearchParams(options.body).get("public_id");
    deleteCalls.push(publicId);
    if (failNextDeletes > 0) {
      failNextDeletes--;
      return new Response(JSON.stringify({ error: { message: "Service unavailable" } }), { status: 503 });
    }
    return new Response(JSON.stringify({ result: "ok" }));
  };
  // Fast polling and a 1-second retry delay, so the test doesn't wait minutes
  boss = await startQueue({
    pollingIntervalSeconds: 0.5,
    queueOverrides: { "delete-image": { retryDelay: 1, retryBackoff: false } }
  });
});
after(async () => {
  await stopQueue();
  globalThis.fetch = realFetch;
  await closeDatabase();
});
beforeEach(async () => {
  await resetDatabase();
  deleteCalls = [];
  failNextDeletes = 0;
});

const waitFor = async (check, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out waiting");
};

const publicId = () => `ecommerce/products/${crypto.randomUUID()}`;

describe("job queue (pg-boss)", () => {

  it("saves a job and a worker runs it shortly after", async () => {
    const id = publicId();
    const jobId = await enqueue("delete-image", { publicId: id });
    assert.ok(jobId, "enqueue returns the job's id when the queue is running");

    await waitFor(() => deleteCalls.includes(id));
    const job = await waitFor(async () => {
      const j = await boss.getJobById("delete-image", jobId);
      return j?.state === "completed" && j;
    });
    assert.equal(job.data.publicId, id);
  });

  it("retries a job that fails, until it works", async () => {
    failNextDeletes = 2;                 // Cloudinary is down for the first two tries
    const id = publicId();
    const jobId = await enqueue("delete-image", { publicId: id });

    const job = await waitFor(async () => {
      const j = await boss.getJobById("delete-image", jobId);
      return j?.state === "completed" && j;
    }, 20_000);
    assert.equal(deleteCalls.filter((c) => c === id).length, 3);
    assert.equal(job.retryCount, 2);
  });

  it("deletes a replaced product image in the background", async () => {
    const admin = await createUser({ role: "admin" });
    const product = await createProduct();
    const url = (id) => `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/v1/${id}.jpg`;
    const first = publicId();
    await api().patch(`/products/${product.id}/image`).set(admin.auth).send({ imageUrl: url(first) }).expect(200);

    await api().patch(`/products/${product.id}/image`).set(admin.auth).send({ imageUrl: url(publicId()) }).expect(200);
    await waitFor(() => deleteCalls.includes(first));
  });

  it("has the maintenance job scheduled once a minute", async () => {
    const schedules = await boss.getSchedules();
    const maintenance = schedules.filter((s) => s.name === "maintenance");
    assert.equal(maintenance.length, 1);
    assert.equal(maintenance[0].cron, "* * * * *");
  });

  it("a job queued inside a transaction exists only if that transaction commits", async () => {
    const count = async () =>
      (await pool.query("SELECT COUNT(*)::int AS n FROM pgboss.job WHERE name = 'order-email'")).rows[0].n;
    const before = await count();
    const job = { orderId: crypto.randomUUID(), type: "placed" };

    await assert.rejects(
      withTransaction(async (client) => {
        await enqueue("order-email", job, { client });
        throw new Error("something later in the transaction fails");
      }),
      /something later/
    );
    assert.equal(await count(), before, "the job must disappear with the rollback");

    await withTransaction(async (client) => {
      await enqueue("order-email", job, { client });
    });
    assert.equal(await count(), before + 1);
  });

  it("a successful checkout queues its email and a worker sends it; a refused one queues none", async () => {
    const orderEmailJobs = async () =>
      (await pool.query("SELECT COUNT(*)::int AS n FROM pgboss.job WHERE name = 'order-email'")).rows[0].n;
    const user = await createUser();
    await createAddress(user);
    const lamp = await createProduct({ stock: 3 });

    // A checkout that fails (out of stock) and rolls back
    await api().post("/cart/items").set(user.auth).send({ productId: lamp.id, quantity: 3 }).expect(200);
    await setVariantFields(lamp.id, { stock: 1 });
    const before = await orderEmailJobs();
    await api().post("/orders").set(user.auth).send({}).expect(409);
    assert.equal(await orderEmailJobs(), before, "no email job may survive a rollback");

    // A checkout that commits: its email job exists and a worker sends it
    await api().patch(`/cart/items/${lamp.id}`).set(user.auth).send({ quantity: 1 }).expect(200);
    const order = (await api().post("/orders").set(user.auth).send({}).expect(201)).body.data;
    assert.equal(await orderEmailJobs(), before + 1);
    await waitFor(() => sentEmails.some((e) => e.subject === `We've got your order ${order.orderNumber}`));
  });

  it("maintenance cancels expired orders when it runs", async () => {
    const user = await createUser();
    await createAddress(user);
    const lamp = await createProduct({ stock: 5 });
    const order = (await placeOrder(user, [[lamp.id, 2]])).body.data;
    await pool.query("UPDATE orders SET created_at = NOW() - INTERVAL '30 days' WHERE id = $1", [order.id]);

    await enqueue("maintenance");
    await waitFor(async () =>
      (await pool.query("SELECT status FROM orders WHERE id = $1", [order.id])).rows[0].status === "cancelled"
    );
    const { rows: [row] } = await pool.query("SELECT cancel_reason FROM orders WHERE id = $1", [order.id]);
    assert.equal(row.cancel_reason, "payment_timeout");
  });
});
