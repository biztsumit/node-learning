// Every kind of background job, with its retry rules. The queue (queue.js) runs them.
import { logger } from "../config/logger.js";
import { deleteOldIdempotencyKeys } from "../middlewares/idempotency.middleware.js";
import { deleteImage } from "../services/cloudinary.client.js";
import { expireUnpaidOrders } from "../services/order.services.js";
import { retryPendingRefunds } from "../services/refund.services.js";

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
      if (cancelled.length > 0 || deletedKeys > 0 || retriedRefunds > 0) {
        logger.info(
          { cancelledOrders: cancelled.length, deletedIdempotencyKeys: deletedKeys, retriedRefunds },
          "Maintenance finished"
        );
      }
    }
  }
};
