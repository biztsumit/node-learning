// The background job queue: pg-boss, which keeps jobs in our own PostgreSQL database
// (in its own "pgboss" schema, created and upgraded automatically on start).
//
//   enqueue("delete-image", { publicId })   → saved as a job; a worker runs it soon after
//   if it throws                            → retried later, following the job's rules
//
// Why jobs in PostgreSQL? No extra service to install, pay for or monitor, and a job is
// as safe as any other row: it survives restarts, and workers claim jobs with
// FOR UPDATE SKIP LOCKED (the same idea as our order-expiry query).
import { PgBoss } from "pg-boss";
import { connectionConfig } from "../config/db.js";
import { logger } from "../config/logger.js";
import { JOBS } from "./definitions.js";
import { runWithContext } from "../context/request-context.ts";

let boss = null;

// Started by server.js only. Tests and command-line scripts don't start it (see enqueue).
// queueOverrides lets tests shorten retry delays, e.g. { "delete-image": { retryDelay: 1 } }
export const startQueue = async ({ pollingIntervalSeconds = 2, queueOverrides = {} } = {}) => {
  boss = new PgBoss({ ...connectionConfig, application_name: "ecommerce-api-jobs" });
  boss.on("error", (err) => logger.error({ err }, "Job queue error"));
  await boss.start();

  for (const [name, job] of Object.entries(JOBS)) {
    const queueOptions = { ...job.queue, ...queueOverrides[name] };
    await boss.createQueue(name, queueOptions);      // does nothing if it already exists...
    const { policy, ...changeable } = queueOptions;
    await boss.updateQueue(name, changeable);        // ...so apply any changed retry rules

    // Changes a job makes are logged as coming from it (e.g. "job:maintenance" cancelling an order)
    await boss.work(name, { pollingIntervalSeconds }, async ([queued]) => {
      await runWithContext({ source: `job:${name}`, requestId: queued.id }, () => job.run(queued.data ?? {}));
    });

    if (job.schedule) {
      await boss.schedule(name, job.schedule);
    }
  }

  logger.info({ queues: Object.keys(JOBS) }, "Job queue started");
  return boss;
};

// Adds a job to the queue.
//
// Pass { client } from withTransaction to make the job part of that transaction:
//   - with a running queue, the job row is inserted THROUGH that client, so it's saved
//     only if the transaction commits (a rolled-back order never sends an email);
//   - without one, it runs right after the commit (and not at all on a rollback).
//
// Without a running queue (tests, scripts) and without a client, it runs right away,
// so the same code works everywhere; a failure is then thrown to the caller.
export const enqueue = async (name, data = {}, { client, ...options } = {}) => {
  const job = JOBS[name];
  if (!job) {
    throw new Error(`Unknown job "${name}"`);
  }

  if (!boss) {
    if (client) {
      client.afterCommit(() => job.run(data));
      return null;
    }
    await job.run(data);
    return null;
  }

  return boss.send(name, data, {
    ...options,
    ...(client && { db: { executeSql: (text, values) => client.query(text, values) } })
  });
};

// Graceful shutdown: let running jobs finish (up to 10 s), then close the queue's connections
export const stopQueue = async () => {
  if (boss) {
    const stopping = boss;
    boss = null;
    await stopping.stop({ graceful: true, timeout: 10_000 });
  }
};
