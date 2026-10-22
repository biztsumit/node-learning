// Usage: npm run expire-orders
// Runs the unpaid-order expiry once and exits. The web server already does this every
// minute; this script is for running it by hand, or from a platform's cron job.
import pool from "../config/db.ts";
import { expireUnpaidOrders } from "../services/order.services.ts";
import { errorMessage } from "../utils/app-error.ts";

try {
  const cancelled = await expireUnpaidOrders({ maxOrders: 10_000 });
  console.log(`Cancelled ${cancelled.length} unpaid order(s)`);
} catch (err) {
  console.error("Expiring orders failed:", errorMessage(err));
  process.exitCode = 1;
} finally {
  await pool.end();
}
