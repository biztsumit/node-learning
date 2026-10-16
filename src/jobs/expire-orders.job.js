import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { deleteOldIdempotencyKeys } from "../middlewares/idempotency.middleware.js";
import { expireUnpaidOrders } from "../services/order.services.js";

// Runs every ORDER_EXPIRY_CHECK_SECONDS inside the web server:
//   - expireUnpaidOrders(): cancel unpaid orders past their deadline, release their stock
//   - deleteOldIdempotencyKeys(): forget Idempotency-Keys older than 24 hours
// Returns a function that stops it (used during graceful shutdown).
export const startOrderExpiryJob = () => {

  let running = false;

  const run = async () => {
    // If the previous run is still going (e.g. a slow database), skip this turn
    // instead of starting a second, overlapping run in the same process
    if (running) {
      return;
    }
    running = true;
    try {
      const cancelled = await expireUnpaidOrders();
      const forgottenKeys = await deleteOldIdempotencyKeys();
      if (cancelled.length > 0 || forgottenKeys > 0) {
        logger.info({ cancelledOrders: cancelled.length, deletedIdempotencyKeys: forgottenKeys }, "Background job finished");
      }
    } catch (err) {
      // A failed run must not crash the web server; the next run will try again
      logger.error({ err }, "Order expiry job failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(run, env.ORDER_EXPIRY_CHECK_SECONDS * 1000);
  // Don't keep the process alive just for this timer
  timer.unref();

  logger.info(
    { everySeconds: env.ORDER_EXPIRY_CHECK_SECONDS, timeoutMinutes: env.ORDER_PAYMENT_TIMEOUT_MINUTES },
    "Order expiry job started"
  );
  run();

  return () => clearInterval(timer);
};
