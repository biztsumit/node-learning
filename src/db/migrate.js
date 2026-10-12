// Usage: npm run migrate
// Runs every .sql file in ./migrations that hasn't been run yet, in name order.
import fs from "node:fs/promises";
import path from "node:path";
import pool from "../config/db.js";

const migrationsDir = path.join(import.meta.dirname, "migrations");

const runMigrations = async () => {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query("SELECT name FROM schema_migrations");
  const alreadyRun = new Set(rows.map((row) => row.name));

  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const pending = files.filter((file) => !alreadyRun.has(file));

  if (pending.length === 0) {
    console.log("Database is up to date");
    return;
  }

  for (const file of pending) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }
};

try {
  await runMigrations();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
