// Runs once before the tests ("pretest" in package.json): creates the test database
// if it doesn't exist yet, and applies every migration to it.
import "dotenv/config";
import { spawnSync } from "node:child_process";
import pg from "pg";

const testDb = process.env.TEST_DB_NAME ?? "ecommerce_test";

if (!/^[a-z0-9_]+_test$/.test(testDb)) {
  console.error(`Test database name "${testDb}" must only use a-z, 0-9, _ and end with "_test"`);
  process.exit(1);
}

// Connect to the normal database just to check/create the test one
const client = new pg.Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

await client.connect();
const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [testDb]);
if (rowCount === 0) {
  // A database name can't be a $1 placeholder; it's safe here because of the check above
  await client.query(`CREATE DATABASE "${testDb}"`);
  console.log(`Created test database ${testDb}`);
}
await client.end();

// Run the normal migration script, but pointed at the test database
const result = spawnSync(process.execPath, ["src/db/migrate.ts"], {
  env: { ...process.env, DB_NAME: testDb, LOG_LEVEL: "silent" },
  stdio: "inherit"
});
process.exit(result.status ?? 1);
