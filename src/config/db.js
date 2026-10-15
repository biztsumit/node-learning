import pg from "pg";

import { env } from "./env.js";
import { logger } from "./logger.js";

const { Pool } = pg;

const pool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME
});

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected PostgreSQL error");
});

// Checks the database is reachable. Tables are created by "npm run migrate".
export const connectDB = async () => {
  await pool.query("SELECT 1");
  logger.info({ host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME }, "PostgreSQL connected");
};

export default pool;
