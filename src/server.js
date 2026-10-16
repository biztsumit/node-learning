import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import app from "./app.js";
import pool, { connectDB } from "./config/db.js";
import { startTunnel } from "./tunnel.js";
import { startOrderExpiryJob } from "./jobs/expire-orders.job.js";

const PORT = env.PORT;

// Last line of defence: an error nobody caught means the app may be in a broken state.
// Log it loudly, then exit so a process manager can start a fresh copy.
process.on("unhandledRejection", (err) => {
  logger.fatal({ err }, "Unhandled promise rejection");
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  process.exit(1);
});

// Graceful shutdown. When the platform deploys a new version (or you press Ctrl+C), it asks
// this process to stop. Stop accepting NEW requests, let the ones in progress finish, close
// the database pool, then exit. Without this, a customer mid-checkout could get cut off.
const shutdown = (server, stopJobs) => (signal) => {
  logger.info({ signal }, "Shutting down: no new requests, finishing the current ones");
  stopJobs();

  // If something hangs, don't wait forever: the platform would kill us anyway
  setTimeout(() => {
    logger.error("Shutdown took too long, forcing exit");
    process.exit(1);
  }, 10_000).unref();

  server.close(async () => {
    await pool.end();
    logger.info("Shutdown complete");
    process.exit(0);
  });
};

const startServer = async () => {
  try {
    await connectDB();
  } catch (err) {
    logger.fatal({ err }, "Failed to connect to PostgreSQL");
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    logger.info({ port: PORT, env: env.NODE_ENV, logLevel: env.LOG_LEVEL }, "Server running");
    startTunnel(PORT);
  });

  // Background work that runs alongside the API (started here, not in app.js, so tests
  // that import the app don't get timers running behind their backs)
  const stopOrderExpiryJob = startOrderExpiryJob();

  process.on("SIGTERM", shutdown(server, stopOrderExpiryJob));   // sent by hosting platforms, Docker, systemd
  process.on("SIGINT", shutdown(server, stopOrderExpiryJob));    // Ctrl+C in a terminal
};

startServer();
