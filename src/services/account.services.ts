// "Forgot password" and "verify your email": the flows that work through one-time links.
import bcrypt from "bcryptjs";
import pool from "../config/db.js";
import { logger } from "../config/logger.js";
import { withTransaction } from "../db/transaction.ts";
import { enqueue } from "../jobs/queue.js";
import { AppError } from "../utils/app-error.ts";
import { consumeToken, createToken, type TokenPurpose } from "./auth-token.services.ts";

const INVALID_LINK = "This link is invalid, has already been used, or has expired. Please request a new one";

// Creates a token and queues its email, in one transaction: both are saved, or neither
const createTokenAndEmail = (userId: string, purpose: TokenPurpose): Promise<void> =>
  withTransaction(async (client) => {
    const token = await createToken(client, userId, purpose);
    await enqueue("auth-email", { userId, type: purpose, token }, { client });
  });

// POST /auth/forgot-password. Same outcome for every email address (see the controller).
export const requestPasswordReset = async (email: string): Promise<void> => {
  const { rows: [user] } = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  if (!user) {
    logger.info("Password reset requested for an email with no account");
    return;
  }
  await createTokenAndEmail(user.id, "password_reset");
};

// POST /auth/reset-password
export const resetPassword = async (token: string, newPassword: string): Promise<void> => {
  // Hash first (slow on purpose), so the transaction below stays short
  const passwordHash = await bcrypt.hash(newPassword, 10);

  await withTransaction(async (client) => {
    const userId = await consumeToken(client, token, "password_reset");
    if (!userId) {
      throw new AppError(400, INVALID_LINK);
    }
    // New password, AND every existing login ends (token_version + 1): if someone else
    // got into the account, resetting the password throws them out.
    // The link also proved the user can read this inbox, so the email counts as verified.
    await client.query(
      `UPDATE users
       SET password_hash = $1, token_version = token_version + 1,
           email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, userId]
    );
  });
};

// After registering, and POST /auth/resend-verification
export const sendVerificationEmail = async (userId: string): Promise<void> => {
  const { rows: [user] } = await pool.query<{ email_verified_at: Date | null }>("SELECT email_verified_at FROM users WHERE id = $1", [userId]);
  if (!user) {
    throw new AppError(404, "User not found");
  }
  if (user.email_verified_at) {
    throw new AppError(409, "Your email address is already verified");
  }
  await createTokenAndEmail(userId, "email_verification");
};

// POST /auth/verify-email
export const verifyEmail = async (token: string): Promise<void> => {
  await withTransaction(async (client) => {
    const userId = await consumeToken(client, token, "email_verification");
    if (!userId) {
      throw new AppError(400, INVALID_LINK);
    }
    await client.query(
      "UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW() WHERE id = $1",
      [userId]
    );
  });
};
