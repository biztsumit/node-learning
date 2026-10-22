// Two-factor login: something you KNOW (password) + something you HAVE (the phone with the
// authenticator app). A stolen password alone is then not enough to get in.
//
//   1. setup   → we create a secret; the user scans it into their app (QR code / otpauth link)
//   2. enable  → the user types a code from the app, proving it works; only then is 2FA on.
//                They get 10 one-time recovery codes, for when the phone is lost.
//   3. login   → password, then a code (or a recovery code)
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import pool from "../config/db.ts";
import { env } from "../config/env.ts";
import { withTransaction } from "../db/transaction.ts";
import { AppError } from "../utils/app-error.ts";
import { decryptSecret, encryptSecret } from "../utils/secret-box.ts";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "../utils/totp.ts";

const RECOVERY_CODE_COUNT = 10;

const hashCode = (code: string): string => crypto.createHash("sha256").update(code).digest("hex");

// "k7m2-q9xp": 8 random characters from a set without look-alikes, easy to copy from paper
const newRecoveryCode = (): string => {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const pick = Array.from({ length: 8 }, () => chars.charAt(crypto.randomInt(chars.length))).join("");
  return `${pick.slice(0, 4)}-${pick.slice(4)}`;
};

// What people type: "K7M2 Q9XP", "k7m2q9xp" and "k7m2-q9xp" are the same code
const normaliseRecoveryCode = (code: string): string => {
  const clean = code.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
};

type TwoFactorRow = { email: string; totp_secret: string | null; totp_enabled_at: Date | null; totp_last_step: string | null };

const lockUser = async (client: PoolClient, userId: string): Promise<TwoFactorRow> => {
  const { rows: [user] } = await client.query<TwoFactorRow>(
    "SELECT email, totp_secret, totp_enabled_at, totp_last_step FROM users WHERE id = $1 FOR UPDATE",
    [userId]
  );
  if (!user) {
    throw new AppError(404, "User not found");
  }
  return user;
};

export type TwoFactorStatus = { enabled: boolean; recoveryCodesLeft: number };

// GET /auth/2fa
export const getStatus = async (userId: string): Promise<TwoFactorStatus> => {
  const { rows: [row] } = await pool.query<{ enabled: boolean; left: number }>(
    `SELECT totp_enabled_at IS NOT NULL AS enabled,
            (SELECT COUNT(*)::int FROM recovery_codes WHERE user_id = u.id AND used_at IS NULL) AS left
     FROM users u WHERE id = $1`,
    [userId]
  );
  return { enabled: row?.enabled ?? false, recoveryCodesLeft: row?.left ?? 0 };
};

// POST /auth/2fa/setup: a new secret for the user's authenticator app (2FA isn't on yet)
export const beginSetup = (userId: string): Promise<{ secret: string; otpauthUrl: string }> =>
  withTransaction(async (client) => {
    const user = await lockUser(client, userId);
    if (user.totp_enabled_at) {
      throw new AppError(409, "Two-factor login is already on. Turn it off first to set up a new device");
    }
    const secret = generateTotpSecret();
    await client.query("UPDATE users SET totp_secret = $1, totp_last_step = NULL WHERE id = $2", [encryptSecret(secret), userId]);
    return { secret, otpauthUrl: otpauthUrl({ secret, account: user.email, issuer: env.EMAIL_FROM_NAME }) };
  });

// Checks a 6-digit code against the user's secret and records its time step, so the same
// code can't be used twice (someone watching over a shoulder can't reuse it within 30 s)
const acceptTotp = async (client: PoolClient, userId: string, user: TwoFactorRow, code: string): Promise<boolean> => {
  if (!user.totp_secret) {
    return false;
  }
  const step = verifyTotp(decryptSecret(user.totp_secret), code);
  if (step === null || (user.totp_last_step !== null && step <= Number(user.totp_last_step))) {
    return false;
  }
  await client.query("UPDATE users SET totp_last_step = $1 WHERE id = $2", [step, userId]);
  return true;
};

// POST /auth/2fa/enable { code }: proves the app works, turns 2FA on, returns recovery codes
export const enable = (userId: string, code: string): Promise<{ recoveryCodes: string[] }> =>
  withTransaction(async (client) => {
    const user = await lockUser(client, userId);
    if (user.totp_enabled_at) {
      throw new AppError(409, "Two-factor login is already on");
    }
    if (!user.totp_secret) {
      throw new AppError(409, "Start with POST /auth/2fa/setup");
    }
    if (!(await acceptTotp(client, userId, user, code))) {
      throw new AppError(400, "Validation failed", [{ field: "code", message: "That code isn't right. Check the time on your phone and try the newest code" }]);
    }

    await client.query("UPDATE users SET totp_enabled_at = NOW() WHERE id = $1", [userId]);
    await client.query("DELETE FROM recovery_codes WHERE user_id = $1", [userId]);
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    for (const recoveryCode of recoveryCodes) {
      await client.query("INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)", [userId, hashCode(recoveryCode)]);
    }
    // Shown ONCE: only their hashes are stored
    return { recoveryCodes };
  });

// The second step of a login, and the check before turning 2FA off: a 6-digit app code,
// or one of the recovery codes (each works once)
export const verifySecondFactor = (userId: string, code: string): Promise<boolean> =>
  withTransaction(async (client) => {
    const user = await lockUser(client, userId);
    if (!user.totp_enabled_at) {
      return false;
    }
    if (/^\d{6}$/.test(code.trim())) {
      return acceptTotp(client, userId, user, code.trim());
    }
    const { rowCount } = await client.query(
      `UPDATE recovery_codes SET used_at = NOW()
       WHERE id = (SELECT id FROM recovery_codes
                   WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL LIMIT 1)`,
      [userId, hashCode(normaliseRecoveryCode(code))]
    );
    return rowCount === 1;
  });

// POST /auth/2fa/disable { password, code }: both, so neither a stolen session nor a stolen
// phone alone can switch it off
export const disable = async (userId: string, { password, code }: { password: string; code: string }): Promise<void> => {
  const { rows: [user] } = await pool.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [userId]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(400, "Validation failed", [{ field: "password", message: "password is incorrect" }]);
  }
  if (!(await verifySecondFactor(userId, code))) {
    throw new AppError(400, "Validation failed", [{ field: "code", message: "That code isn't right" }]);
  }
  await withTransaction(async (client) => {
    await client.query("UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = $1", [userId]);
    await client.query("DELETE FROM recovery_codes WHERE user_id = $1", [userId]);
  });
};
