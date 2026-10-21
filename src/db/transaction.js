import pool from "../config/db.js";
import { logger } from "../config/logger.js";

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
