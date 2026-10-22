// One-time tokens for "reset your password" and "verify your email" links.
import crypto from "node:crypto";
import type { PoolClient } from "pg";
import pool from "../config/db.js";

// Must match the CHECK on auth_tokens.purpose (migration 018)
export type TokenPurpose = "password_reset" | "email_verification";

// Record<TokenPurpose, number>: every purpose must have a lifetime
export const TOKEN_LIFETIME_MINUTES: Record<TokenPurpose, number> = {
  password_reset: 60,               // short: whoever has the link can take over the account
  email_verification: 24 * 60
};

// Tokens are random (32 bytes = 256 bits), so a fast hash is enough. bcrypt is slow on
// purpose to protect GUESSABLE passwords; nobody can guess 256 random bits anyway.
export const hashToken = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");

// Creates a new token for this purpose and returns the RAW token (to put in the email).
// Any older unused token for the same purpose stops working, so only the newest link works.
export const createToken = async (client: PoolClient, userId: string, purpose: TokenPurpose): Promise<string> => {
  await client.query(
    "UPDATE auth_tokens SET used_at = NOW() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL",
    [userId, purpose]
  );

  const token = crypto.randomBytes(32).toString("base64url");   // URL-safe: no + / =
  await client.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(mins => $4))`,
    [userId, purpose, hashToken(token), TOKEN_LIFETIME_MINUTES[purpose]]
  );
  return token;
};

// Checks a token and marks it used, all at once. Returns the user id, or null if the token
// is unknown, for another purpose, already used or expired. Run inside a transaction:
// FOR UPDATE makes a second, simultaneous use of the same link wait and then find it used.
export const consumeToken = async (client: PoolClient, token: string, purpose: TokenPurpose): Promise<string | null> => {
  const { rows: [row] } = await client.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM auth_tokens
     WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > NOW()
     FOR UPDATE`,
    [hashToken(String(token)), purpose]
  );
  if (!row) {
    return null;
  }
  await client.query("UPDATE auth_tokens SET used_at = NOW() WHERE id = $1", [row.id]);
  return row.user_id;
};

// Housekeeping: tokens that can never be used again are just clutter. Returns how many went.
export const deleteDeadTokens = async (): Promise<number> => {
  const { rowCount } = await pool.query(
    "DELETE FROM auth_tokens WHERE (used_at IS NOT NULL OR expires_at < NOW()) AND created_at < NOW() - INTERVAL '1 day'"
  );
  return rowCount ?? 0;
};
