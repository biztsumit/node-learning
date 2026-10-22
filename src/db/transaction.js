import pool from "../config/db.js";
import { logger } from "../config/logger.js";
import { getContext } from "../context/request-context.js";

// Tells the database who is acting (for the audit log and stock ledger triggers):
// the logged-in user, the request id, and where it came from ("api", "job:maintenance").
// set_config(..., true) = only for this transaction, so a pooled connection never carries
// one request's identity into the next.
const applyContext = async (client) => {
  const context = getContext();
  if (!context) {
    return;
  }
  await client.query(
    `SELECT set_config('app.user_id', $1, true),
            set_config('app.request_id', $2, true),
            set_config('app.source', $3, true)`,
    [context.userId ?? "", context.requestId ?? "", context.source ?? ""]
  );
};

// Runs `work` inside a database transaction: either every query in it is saved, or none are.
//
// Usage:
//   const result = await withTransaction(async (client) => {
//     await client.query("UPDATE ...");
//     await client.query("INSERT ...");
//     return something;
//   });
//
// Inside `work`, use `client.query`, NOT `pool.query`: the pool might run a query on a
// different connection, which would be outside this transaction.
//
// client.afterCommit(fn) registers something to run only once the transaction has been
// saved (e.g. a job that must never run for a rolled-back change). If it rolls back,
// those functions are simply dropped.
export const withTransaction = async (work) => {
  const client = await pool.connect();
  const afterCommit = [];
  client.afterCommit = (fn) => afterCommit.push(fn);

  try {
    await client.query("BEGIN");
    await applyContext(client);
    const result = await work(client);
    await client.query("COMMIT");

    for (const fn of afterCommit) {
      try {
        await fn();
      } catch (err) {
        // The transaction is already saved; a failing follow-up mustn't pretend it wasn't
        logger.error({ err }, "After-commit task failed");
      }
    }
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    delete client.afterCommit;
    client.release();
  }
};

// A single write that should say who made it (audited tables: products, categories, coupons,
// users...). It runs in its own small transaction so the "who" settings can travel with it.
// A plain pool.query would still be audited, just as an unknown actor.
export const queryWithContext = (sql, values) => withTransaction((client) => client.query(sql, values));
