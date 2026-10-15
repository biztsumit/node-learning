import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import app from "./app.js";
import { connectDB } from "./config/db.js";
import { startTunnel } from "./tunnel.js";

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

const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, () => {
      logger.info({ port: PORT, env: env.NODE_ENV, logLevel: env.LOG_LEVEL }, "Server running");
      startTunnel(PORT);
    });
  } catch (err) {
    logger.fatal({ err }, "Failed to connect to PostgreSQL");
    process.exit(1);
  }
};

startServer();
