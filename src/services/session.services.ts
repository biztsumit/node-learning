// Login sessions: a short-lived ACCESS token (sent with every request) and a long-lived
// REFRESH token (kept in an httpOnly cookie, only used to get new access tokens).
//
// Why two? An access token can't be cancelled before it expires without a database lookup,
// so it lives only 15 minutes. The refresh token IS checked in the database every time, so it
// can live for weeks and still be cancelled at once (logout, password change, theft).
//
// Rotation: every refresh hands out a NEW refresh token and retires the old one. If a retired
// token is ever presented again, someone has a copy (it was stolen): the whole session (the
// "family" of tokens) is revoked, so the thief AND the victim are logged out, and the victim
// simply logs in again.
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import pool from "../config/db.ts";
import { env } from "../config/env.ts";
import { logger } from "../config/logger.ts";
import { withTransaction } from "../db/transaction.ts";
import { AppError } from "../utils/app-error.ts";
import type { Role } from "../types/express.d.ts";

// A refresh token used again within this many seconds of being rotated is most likely two
// tabs refreshing at the same moment, not theft: refuse it, but don't end the session
const REUSE_GRACE_SECONDS = 10;

const hashToken = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");

export type SessionUser = { id: string; role: Role; token_version: number };

export type IssuedSession = {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
};

// The access token: who (userId), still valid? (tokenVersion), and whether this login passed
// two-factor (mfa). The role isn't in it: requireAuth reads it fresh from the database.
// audience "access": requireAuth accepts ONLY tokens made for that purpose. The 2FA login
// challenge is also a signed token with a userId; without the audience check it could be
// used as an access token, skipping the code ("token confusion").
export const ACCESS_AUDIENCE = "access";
export const createAccessToken = (user: { id: string; token_version: number }, { mfa }: { mfa: boolean }): string =>
  jwt.sign(
    { userId: user.id, tokenVersion: user.token_version, mfa },
    env.JWT_SECRET,
    // env.ts checked it looks like "15m"; jsonwebtoken's types want that exact shape
    { expiresIn: env.JWT_EXPIRES_IN as NonNullable<jwt.SignOptions["expiresIn"]>, audience: ACCESS_AUDIENCE }
  );

// Stores a new refresh token (only its hash) and returns the raw one, for the cookie
const insertRefreshToken = async (
  db: { query: typeof pool.query },
  { userId, familyId, mfa, userAgent }: { userId: string; familyId: string; mfa: boolean; userAgent: string | undefined }
): Promise<{ refreshToken: string; refreshExpiresAt: Date }> => {
  const refreshToken = crypto.randomBytes(32).toString("base64url");
  const { rows: [row] } = await db.query<{ expires_at: Date }>(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, mfa, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(days => $6))
     RETURNING expires_at`,
    [userId, familyId, hashToken(refreshToken), mfa, userAgent?.slice(0, 255) ?? null, env.REFRESH_TOKEN_DAYS]
  );
  if (!row) {
    throw new Error("Could not store the refresh token");
  }
  return { refreshToken, refreshExpiresAt: row.expires_at };
};

// After a successful login (with or without two-factor): a brand-new session
export const startSession = async (
  user: SessionUser,
  { mfa, userAgent }: { mfa: boolean; userAgent: string | undefined }
): Promise<IssuedSession> => {
  const { refreshToken, refreshExpiresAt } = await insertRefreshToken(pool, {
    userId: user.id, familyId: crypto.randomUUID(), mfa, userAgent
  });
  return { accessToken: createAccessToken(user, { mfa }), refreshToken, refreshExpiresAt };
};

const sessionEnded = () => new AppError(401, "Your session has ended. Please log in again");

type StoredToken = {
  id: string;
  user_id: string;
  family_id: string;
  mfa: boolean;
  expired: boolean;
  used_seconds_ago: number | null;
  revoked_at: Date | null;
};

// POST /auth/refresh: the old refresh token in, a new access token AND refresh token out
export const refreshSession = async (rawToken: string, userAgent: string | undefined): Promise<IssuedSession> => {
  // What to do is decided inside the transaction; a theft response must COMMIT the revocation
  // before the error is thrown, so it's returned from the transaction rather than thrown in it
  const outcome = await withTransaction(async (client) => {
    // FOR UPDATE: two refreshes with the same token take turns, so only one can rotate it
    const { rows: [stored] } = await client.query<StoredToken>(
      `SELECT id, user_id, family_id, mfa, expires_at <= NOW() AS expired, revoked_at,
              EXTRACT(EPOCH FROM NOW() - used_at)::float AS used_seconds_ago
       FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [hashToken(rawToken)]
    );

    if (!stored || stored.revoked_at || stored.expired) {
      return { kind: "invalid" as const };
    }
    if (stored.used_seconds_ago !== null) {
      if (stored.used_seconds_ago <= REUSE_GRACE_SECONDS) {
        return { kind: "just-rotated" as const };
      }
      // A retired token came back: someone kept a copy. End the whole session.
      await client.query(
        "UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL",
        [stored.family_id]
      );
      return { kind: "reused" as const, userId: stored.user_id, familyId: stored.family_id };
    }

    const { rows: [user] } = await client.query<SessionUser>(
      "SELECT id, role, token_version FROM users WHERE id = $1",
      [stored.user_id]
    );
    if (!user) {
      return { kind: "invalid" as const };
    }

    await client.query("UPDATE refresh_tokens SET used_at = NOW() WHERE id = $1", [stored.id]);
    const { refreshToken, refreshExpiresAt } = await insertRefreshToken(client, {
      userId: user.id, familyId: stored.family_id, mfa: stored.mfa, userAgent
    });
    return {
      kind: "rotated" as const,
      session: { accessToken: createAccessToken(user, { mfa: stored.mfa }), refreshToken, refreshExpiresAt }
    };
  });

  switch (outcome.kind) {
    case "rotated":
      return outcome.session;
    case "reused":
      logger.warn({ userId: outcome.userId, familyId: outcome.familyId }, "Refresh token reused: possible theft, session revoked");
      throw sessionEnded();
    case "just-rotated":
      throw new AppError(409, "This session was just refreshed (another tab?). Retry with the new cookie");
    case "invalid":
      throw sessionEnded();
  }
};

// POST /auth/logout: ends THIS session (every token of its family)
export const endSession = async (rawToken: string): Promise<void> => {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE revoked_at IS NULL
       AND family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
    [hashToken(rawToken)]
  );
};

// Every session of a user: "log out everywhere", a password change or reset
export const endAllSessions = async (userId: string, db: { query: typeof pool.query } = pool): Promise<void> => {
  await db.query("UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
};

// Housekeeping (the maintenance job): tokens that can never be used again
export const deleteDeadSessions = async (): Promise<number> => {
  const { rowCount } = await pool.query(
    "DELETE FROM refresh_tokens WHERE expires_at < NOW() - INTERVAL '1 day' OR revoked_at < NOW() - INTERVAL '7 days'"
  );
  return rowCount ?? 0;
};
