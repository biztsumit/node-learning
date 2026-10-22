// Usage: npm run make-admin -- someone@example.com
import pool from "../config/db.js";
import { updateUserRole } from "../services/user.services.js";
import { runWithContext } from "../context/request-context.ts";

const email = process.argv[2]?.trim().toLowerCase();

if (!email) {
  console.error("Usage: npm run make-admin -- <email>");
  process.exit(1);
}

// Shows up in the audit log as "script:make-admin"
const user = await runWithContext({ source: "script:make-admin" }, () => updateUserRole(email, "admin"));

if (user) {
  console.log(`${user.email} is now an admin`);
} else {
  console.error(`No user found with email ${email}`);
  process.exitCode = 1;
}

await pool.end();
