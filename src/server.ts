import type { Server } from "node:http";
import { env } from "./config/env.ts";
import { logger } from "./config/logger.ts";
import app from "./app.ts";
import pool, { connectDB } from "./config/db.ts";
import { startTunnel } from "./tunnel.ts";
import { startQueue, stopQueue } from "./jobs/queue.ts";
import { startCacheInvalidation, stopCacheInvalidation } from "./cache/invalidation.ts";

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
const shutdown = (server: Server) => (signal: NodeJS.Signals): void => {
  logger.info({ signal }, "Shutting down: no new requests, finishing the current requests and jobs");

  // If something hangs, don't wait forever: the platform would kill us anyway
  setTimeout(() => {
    logger.error("Shutdown took too long, forcing exit");
    process.exit(1);
  }, 15_000).unref();

  server.close(async () => {
    await stopQueue();      // running jobs finish first (they use the database)...
    await stopCacheInvalidation();
    await pool.end();       // ...then the database connections close
    logger.info("Shutdown complete");
    process.exit(0);
  });
};

const startServer = async () => {
  try {
    await connectDB();
    // Background jobs (started here, not in app.js, so tests that import the app
    // don't get workers running behind their backs)
    await startQueue();
    // Clears the catalog cache whenever products/categories/reviews change (on any server)
    await startCacheInvalidation();
  } catch (err) {
    logger.fatal({ err }, "Failed to start: database or job queue unavailable");
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    logger.info({ port: PORT, env: env.NODE_ENV, logLevel: env.LOG_LEVEL }, "Server running");
    startTunnel(PORT);
  });

  process.on("SIGTERM", shutdown(server));   // sent by hosting platforms, Docker, systemd
  process.on("SIGINT", shutdown(server));    // Ctrl+C in a terminal
};

startServer();
