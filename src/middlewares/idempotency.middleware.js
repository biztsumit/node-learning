// Idempotency keys, the way Stripe and Razorpay's own APIs do it.
//
// The client creates a random key (e.g. crypto.randomUUID()) once per ACTION, such as
// "this checkout", and sends it as `Idempotency-Key` on the first try and every retry.
//   first request        → runs normally; the response is saved
//   retry, same key      → the saved response is sent again ("Idempotency-Replayed: true")
//   same key, new body   → 422: a client bug, refusing protects the customer
//   retry while running  → 409: "still in progress, try again shortly"
// Without the header, the route works exactly as before.
import crypto from "node:crypto";
import pool from "../config/db.js";
import { logger } from "../config/logger.js";
import { AppError } from "../utils/app-error.js";

const KEY_FORMAT = /^[A-Za-z0-9_-]{8,255}$/;

// Keys are kept this long; a retry after that counts as a new request
export const KEY_LIFETIME_HOURS = 24;

// A request still "in progress" after this long probably died with a crashed server.
// Its key may then be reused, so the customer isn't stuck forever.
const ABANDONED_AFTER_SECONDS = 60;

const hashRequest = (req) =>
  crypto
    .createHash("sha256")
    .update(`${req.method} ${req.originalUrl}\n${JSON.stringify(req.body ?? {})}`)
    .digest("hex");

// Claims the key for this request. Returns the existing row if someone already has it.
const claimKey = async ({ userId, key, method, path, requestHash }) => {
  // A brand-new key: insert it. ON CONFLICT DO NOTHING means only ONE of several
  // simultaneous requests with the same key can win (the primary key decides).
  const inserted = await pool.query(
    `INSERT INTO idempotency_keys (user_id, key, method, path, request_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, key) DO NOTHING`,
    [userId, key, method, path, requestHash]
  );
  if (inserted.rowCount === 1) {
    return { claimed: true };
  }

  // The key exists. Take it over only if it's expired or its request was abandoned.
  const takenOver = await pool.query(
    `UPDATE idempotency_keys
     SET method = $3, path = $4, request_hash = $5, status = 'in_progress',
         response_status = NULL, response_body = NULL, created_at = NOW()
     WHERE user_id = $1 AND key = $2
       AND (created_at < NOW() - make_interval(hours => $6)
            OR (status = 'in_progress' AND created_at < NOW() - make_interval(secs => $7)))`,
    [userId, key, method, path, requestHash, KEY_LIFETIME_HOURS, ABANDONED_AFTER_SECONDS]
  );
  if (takenOver.rowCount === 1) {
    return { claimed: true };
  }

  const { rows: [existing] } = await pool.query(
    "SELECT request_hash, status, response_status, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2",
    [userId, key]
  );
  return { claimed: false, existing };
};

// Use after requireAuth: router.post("/", idempotency, validate(...), handler)
export const idempotency = async (req, res, next) => {

  const key = req.get("Idempotency-Key");
  if (key === undefined) {
    return next();
  }
  if (!KEY_FORMAT.test(key)) {
    throw new AppError(400, "Idempotency-Key must be 8-255 characters: letters, digits, - and _");
  }

  const userId = req.user.id;
  const requestHash = hashRequest(req);
  const { claimed, existing } = await claimKey({
    userId, key, method: req.method, path: req.originalUrl, requestHash
  });

  if (!claimed) {
    if (existing.request_hash !== requestHash) {
      throw new AppError(422, "This Idempotency-Key was already used for a different request");
    }
    if (existing.status === "in_progress") {
      throw new AppError(409, "A request with this Idempotency-Key is still being processed. Try again shortly");
    }
    // Same request, already finished: send exactly what we sent the first time
    res.set("Idempotency-Replayed", "true");
    return res.status(existing.response_status).json(existing.response_body);
  }

  // We own the key: run the route, and save its response BEFORE sending it, so that a
  // retry arriving a moment later already finds the finished result.
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    const saving = res.statusCode >= 500
      // Our failure: forget the key, so a retry really runs again
      ? pool.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2", [userId, key])
      : pool.query(
          `UPDATE idempotency_keys SET status = 'completed', response_status = $3, response_body = $4
           WHERE user_id = $1 AND key = $2`,
          [userId, key, res.statusCode, body]
        );

    saving
      .catch((err) => logger.error({ err, key }, "Could not save the idempotency result"))
      .finally(() => sendJson(body));
    return res;
  };

  next();
};

// Old keys are only useful for retries within KEY_LIFETIME_HOURS; delete the rest.
// Returns how many were deleted. Run by the background job.
export const deleteOldIdempotencyKeys = async () => {
  const { rowCount } = await pool.query(
    "DELETE FROM idempotency_keys WHERE created_at < NOW() - make_interval(hours => $1)",
    [KEY_LIFETIME_HOURS]
  );
  return rowCount;
};
