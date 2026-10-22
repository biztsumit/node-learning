// Every kind of background job, with its retry rules. The queue (queue.js) runs them.
import { logger } from "../config/logger.js";
import { deleteOldIdempotencyKeys } from "../middlewares/idempotency.middleware.js";
import { deleteImage } from "../services/cloudinary.client.ts";
import { buildAuthEmail } from "../emails/auth-emails.js";
import { buildOrderEmail } from "../emails/order-emails.js";
import { deleteDeadTokens } from "../services/auth-token.services.ts";
import { findUserById } from "../services/user.services.ts";
import { sendEmail } from "../emails/transport.js";
import { expireUnpaidOrders, getOrderById } from "../services/order.services.ts";
import { retryPendingRefunds } from "../services/refund.services.ts";
import { refreshSalesReport } from "../services/report.services.ts";

export const JOBS = {

  // Delete an old product image from Cloudinary.
  // If Cloudinary is down, try again later: after ~30s, ~1m, ~2m, ~4m ... (exponential backoff),
  // up to 6 retries, instead of giving up after one failed attempt.
  "delete-image": {
    queue: { retryLimit: 6, retryDelay: 30, retryBackoff: true },
    run: async ({ publicId }) => {
      await deleteImage(publicId);
      logger.info({ publicId }, "Deleted old product image from Cloudinary");
    }
  },

  // Tell the customer about their order: placed, paid, shipped, delivered, cancelled, refunded.
  // The order is read when the job RUNS, so the email shows its latest state.
  "order-email": {
    queue: { retryLimit: 5, retryDelay: 60, retryBackoff: true },
    run: async ({ orderId, type }) => {
      const order = await getOrderById(orderId);
      if (!order) {
        logger.warn({ orderId, type }, "Order email skipped: order no longer exists");
        return;
      }
      await sendEmail(buildOrderEmail(type, order));
    }
  },

  // "Reset your password" / "Verify your email". The job's data holds the RAW one-time token
  // (it has to reach the email somehow), so these jobs are deleted 10 minutes after they're
  // done, and dropped if still unsent after an hour (the reset link would have expired anyway).
  "auth-email": {
    queue: { retryLimit: 3, retryDelay: 30, retryBackoff: true, deleteAfterSeconds: 600, retentionSeconds: 3600 },
    run: async ({ userId, type, token }) => {
      const user = await findUserById(userId);
      if (!user) {
        return;
      }
      await sendEmail(buildAuthEmail(type, user, token));
    }
  },

  // Re-calculate the sales dashboard's daily numbers every 10 minutes.
  // "exclusive": if one refresh is slow, the next waits instead of piling up.
  "refresh-reports": {
    queue: { policy: "exclusive", retryLimit: 0, expireInSeconds: 10 * 60 },
    schedule: "*/10 * * * *",
    run: async () => {
      await refreshSalesReport();
    }
  },

  // Housekeeping, once a minute. The SCHEDULE lives in the database, so with several servers
  // pg-boss still creates just ONE job per minute, and "exclusive" means a new one can't
  // start while the previous one is still running.
  maintenance: {
    queue: { policy: "exclusive", retryLimit: 0, expireInSeconds: 10 * 60 },
    schedule: "* * * * *",
    run: async () => {
      const cancelled = await expireUnpaidOrders();
      const deletedKeys = await deleteOldIdempotencyKeys();
      const retriedRefunds = await retryPendingRefunds();
      const deletedTokens = await deleteDeadTokens();
      if (cancelled.length > 0 || deletedKeys > 0 || retriedRefunds > 0 || deletedTokens > 0) {
        logger.info(
          { cancelledOrders: cancelled.length, deletedIdempotencyKeys: deletedKeys, retriedRefunds, deletedAuthTokens: deletedTokens },
          "Maintenance finished"
        );
      }
    }
  }
};
