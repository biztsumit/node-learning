// The background job queue: pg-boss, which keeps jobs in our own PostgreSQL database
// (in its own "pgboss" schema, created and upgraded automatically on start).
//
//   enqueue("delete-image", { publicId })   → saved as a job; a worker runs it soon after
//   if it throws                            → retried later, following the job's rules
//
// Why jobs in PostgreSQL? No extra service to install, pay for or monitor, and a job is
// as safe as any other row: it survives restarts, and workers claim jobs with
// FOR UPDATE SKIP LOCKED (the same idea as our order-expiry query).
import { PgBoss, type Queue, type SendOptions } from "pg-boss";
import { connectionConfig } from "../config/db.ts";
import { logger } from "../config/logger.ts";
import { JOBS, type JobData, type JobName } from "./definitions.ts";
import { runWithContext } from "../context/request-context.ts";
import type { TransactionClient } from "../db/transaction.ts";

let boss: PgBoss | null = null;

type QueueSettings = Omit<Queue, "name">;

type StartOptions = {
  pollingIntervalSeconds?: number;
  // Lets tests shorten retry delays, e.g. { "delete-image": { retryDelay: 1 } }
  queueOverrides?: Partial<Record<JobName, Partial<QueueSettings>>>;
};

// Runs one job with data that came out of the queue. The data was type-checked when it was
// enqueued (see enqueue below), but the queue itself stores plain JSON, so here we tell
// TypeScript to trust it: the one place a cast is needed, written down in one place.
const runJob = (name: JobName, data: unknown): Promise<void> =>
  (JOBS[name].run as (data: unknown) => Promise<void>)(data ?? {});

// Started by server.ts only. Tests and command-line scripts don't start it (see enqueue).
export const startQueue = async ({ pollingIntervalSeconds = 2, queueOverrides = {} }: StartOptions = {}): Promise<PgBoss> => {
  const started = new PgBoss({ ...connectionConfig, application_name: "ecommerce-api-jobs" });
  started.on("error", (err: unknown) => logger.error({ err }, "Job queue error"));
  await started.start();
  boss = started;

  for (const name of Object.keys(JOBS) as JobName[]) {
    const job = JOBS[name];
    const queueOptions: QueueSettings = { ...job.queue, ...queueOverrides[name] };
    await started.createQueue(name, queueOptions);      // does nothing if it already exists...
    const { policy, ...changeable } = queueOptions;
    await started.updateQueue(name, changeable);        // ...so apply any changed retry rules

    // Changes a job makes are logged as coming from it (e.g. "job:maintenance" cancelling an order)
    await started.work(name, { pollingIntervalSeconds }, async ([queued]) => {
      if (!queued) {
        return;
      }
      await runWithContext({ source: `job:${name}`, requestId: queued.id }, () => runJob(name, queued.data));
    });

    if (job.schedule) {
      await started.schedule(name, job.schedule);
    }
  }

  logger.info({ queues: Object.keys(JOBS) }, "Job queue started");
  return started;
};

// Adds a job to the queue. <N extends JobName>: the name picks the job, and TypeScript then
// requires exactly that job's data: enqueue("order-email", { orderId, type: "placed" }).
// A misspelled job name or a missing field is a compile error, not a job failing at 3 a.m.
//
// Pass { client } from withTransaction to make the job part of that transaction:
//   - with a running queue, the job row is inserted THROUGH that client, so it's saved
//     only if the transaction commits (a rolled-back order never sends an email);
//   - without one, it runs right after the commit (and not at all on a rollback).
//
// Without a running queue (tests, scripts) and without a client, it runs right away,
// so the same code works everywhere; a failure is then thrown to the caller.
export const enqueue = async <N extends JobName>(
  name: N,
  data: JobData<N>,
  { client, ...options }: { client?: TransactionClient } & SendOptions = {}
): Promise<string | null> => {
  if (!(name in JOBS)) {
    throw new Error(`Unknown job "${name}"`);
  }

  if (!boss) {
    if (client) {
      client.afterCommit(() => runJob(name, data));
      return null;
    }
    await runJob(name, data);
    return null;
  }

  return boss.send(name, data, {
    ...options,
    ...(client && { db: { executeSql: (text: string, values?: unknown[]) => client.query(text, values) } })
  });
};

// Graceful shutdown: let running jobs finish (up to 10 s), then close the queue's connections
export const stopQueue = async (): Promise<void> => {
  if (boss) {
    const stopping = boss;
    boss = null;
    await stopping.stop({ graceful: true, timeout: 10_000 });
  }
};
