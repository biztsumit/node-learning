import pg from "pg";

import { env } from "./env.js";
import { logger } from "./logger.js";

const { Pool } = pg;

// Locally we use the separate DB_* settings; hosting platforms give one DATABASE_URL
const connection = env.DATABASE_URL
  ? { connectionString: env.DATABASE_URL }
  : {
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME
    };

const pool = new Pool({
  ...connection,
  // true = encrypted connection AND check the server's certificate
  ...(env.DB_SSL && { ssl: true })
});

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected PostgreSQL error");
});

// Checks the database is reachable. Tables are created by "npm run migrate".
export const connectDB = async () => {
  const { rows } = await pool.query("SELECT current_database() AS database");
  logger.info({ database: rows[0].database, ssl: env.DB_SSL }, "PostgreSQL connected");
};

export default pool;
