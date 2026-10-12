import pg from "pg";

import { env } from "./env.js";

const { Pool } = pg;

const pool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error:", err.message);
});

// Checks the database is reachable. Tables are created by "npm run migrate".
export const connectDB = async () => {
  const result = await pool.query("SELECT NOW()");
  console.log("PostgreSQL connected at", result.rows[0].now);
};

export default pool;
