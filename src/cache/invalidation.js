// Keeps every server's catalog cache up to date, using PostgreSQL's LISTEN/NOTIFY.
// Migration 019 makes the database NOTIFY "catalog_changed" after any change to products,
// categories or reviews; here each server LISTENs and clears its cache when it hears it.
//
// LISTEN needs one connection that stays open (a pool hands connections in and out),
// so this uses its own client, and reconnects if that connection drops.
import pg from "pg";
import { connectionConfig } from "../config/db.js";
import { logger } from "../config/logger.js";
import { catalogCache } from "./catalog-cache.js";

let client = null;
let stopped = true;
let retryTimer = null;

// Without a working connection we can't hear about changes: clear the cache (anything could
// have changed meanwhile) and try again in a few seconds, as many times as it takes
const scheduleReconnect = (err) => {
  if (stopped) return;
  catalogCache.clear();
  logger.warn({ err }, "Cache invalidation connection unavailable; retrying in 5 s");
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => connect().catch(scheduleReconnect), 5000);
  retryTimer.unref();
};

const connect = async () => {
  const next = new pg.Client(connectionConfig);

  next.on("notification", (message) => {
    if (message.channel === "catalog_changed") {
      catalogCache.clear();
      logger.debug({ table: message.payload }, "Catalog changed: cache cleared");
    }
  });

  // "error" and "end" can both fire for one broken connection; react only once
  const onBroken = (err) => {
    if (client !== next) return;
    client = null;
    scheduleReconnect(err);
  };
  next.on("error", onBroken);
  next.on("end", () => onBroken());

  try {
    await next.connect();
    await next.query("LISTEN catalog_changed");
  } catch (err) {
    next.end().catch(() => {});
    throw err;
  }
  client = next;
};

export const startCacheInvalidation = async () => {
  stopped = false;
  await connect();
  logger.info("Listening for catalog changes (cache invalidation)");
};

export const stopCacheInvalidation = async () => {
  stopped = true;
  clearTimeout(retryTimer);
  const closing = client;
  client = null;
  await closing?.end();
};
