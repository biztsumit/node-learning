import pool from "../config/db.js";

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
export const withTransaction = async (work) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
