import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import * as accountService from "../services/account.services.ts";
import * as userService from "../services/user.services.ts";
import { env } from "../config/env.ts";
import { logger } from "../config/logger.js";
import { AppError } from "../utils/app-error.ts";
import { PG_UNIQUE_VIOLATION, isDatabaseError } from "../utils/db-errors.ts";
import { currentUser } from "../middlewares/auth.middleware.ts";
import type { Checked } from "../types/http.ts";
import type {
  ChangePassword, ForgotPassword, Login, Register, ResetPassword, UpdateProfile, VerifyEmail
} from "../validators/auth.validators.ts";

// The account was deleted while this request was running (or never existed)
const sessionEnded = () => new AppError(401, "Your session has ended. Please log in again");

// The role is not put in the token any more: requireAuth reads it fresh from the database.
// tokenVersion must match users.token_version, or the token is refused.
const createToken = (user: { id: string; token_version?: number }): string => {
  return jwt.sign(
    { userId: user.id, tokenVersion: user.token_version ?? 0 },
    env.JWT_SECRET,
    // jsonwebtoken's types only accept strings like "1d" or "15m"; env.ts checked it's set
    { expiresIn: env.JWT_EXPIRES_IN as NonNullable<jwt.SignOptions["expiresIn"]> }
  );
};

export const register = async (req: Checked<Record<string, never>, Register>, res: Response): Promise<void> => {

  const { name, email, password } = req.body;

  const passwordHash = await bcrypt.hash(password, 10);

  let user: userService.PublicUser;

  try {
    user = await userService.createUser({ name, email, passwordHash });
  } catch (err) {
    // The UNIQUE rule on users.email rejected it: someone already has this email
    if (isDatabaseError(err) && err.code === PG_UNIQUE_VIOLATION) {
      throw new AppError(409, "Email is already registered");
    }
    throw err;
  }

  // Ask them to confirm their email. If that fails, the account still exists, and they
  // can ask for a new link with POST /auth/resend-verification.
  try {
    await accountService.sendVerificationEmail(user.id);
  } catch (err) {
    logger.error({ err, userId: user.id }, "Could not send the verification email");
  }

  res.status(201).json({
    success: true,
    data: {
      user: { ...user, email_verified: false },
      token: createToken(user)
    }
  });
};

// POST /auth/forgot-password  { email }
// Always the same answer, whether or not the email has an account. Otherwise this form
// would tell anyone which email addresses are customers of the shop.
export const forgotPassword = async (req: Checked<Record<string, never>, ForgotPassword>, res: Response): Promise<void> => {

  await accountService.requestPasswordReset(req.body.email);

  res.json({
    success: true,
    message: "If an account exists for that email, we've sent a link to reset the password"
  });
};

// POST /auth/reset-password  { token, newPassword }
export const resetPassword = async (req: Checked<Record<string, never>, ResetPassword>, res: Response): Promise<void> => {

  await accountService.resetPassword(req.body.token, req.body.newPassword);

  res.json({
    success: true,
    message: "Password changed. You've been logged out everywhere; log in with the new password"
  });
};

// POST /auth/verify-email  { token }
export const verifyEmail = async (req: Checked<Record<string, never>, VerifyEmail>, res: Response): Promise<void> => {

  await accountService.verifyEmail(req.body.token);

  res.json({
    success: true,
    message: "Thanks, your email address is verified"
  });
};

// POST /auth/resend-verification (logged in)
export const resendVerification = async (req: Request, res: Response): Promise<void> => {

  await accountService.sendVerificationEmail(currentUser(req).id);

  res.json({
    success: true,
    message: "We've sent you a new verification link"
  });
};

export const login = async (req: Checked<Record<string, never>, Login>, res: Response): Promise<void> => {

  const { email, password } = req.body;

  const user = await userService.findUserByEmail(email);

  // "!user ||": TypeScript only knows user exists below because this check says so
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, "Invalid email or password");
  }

  res.json({
    success: true,
    data: {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      token: createToken(user)
    }
  });
};

export const getMe = async (req: Request, res: Response): Promise<void> => {

  const user = await userService.findUserById(currentUser(req).id);

  if (!user) {
    throw new AppError(404, "User not found");
  }

  res.json({
    success: true,
    data: user
  });
};

// PATCH /auth/me  { name }
export const updateMe = async (req: Checked<Record<string, never>, UpdateProfile>, res: Response): Promise<void> => {

  const user = await userService.updateUserName(currentUser(req).id, req.body.name);

  res.json({
    success: true,
    data: user
  });
};

// POST /auth/change-password  { currentPassword, newPassword }
export const changePassword = async (req: Checked<Record<string, never>, ChangePassword>, res: Response): Promise<void> => {

  const { currentPassword, newPassword } = req.body;
  const { id } = currentUser(req);

  // Ask for the current password again: a stolen token alone can't take over the account
  const currentHash = await userService.getPasswordHash(id);
  if (!currentHash) {
    throw sessionEnded();
  }
  const correct = await bcrypt.compare(currentPassword, currentHash);

  if (!correct) {
    throw new AppError(400, "Validation failed", [
      { field: "currentPassword", message: "currentPassword is incorrect" }
    ]);
  }

  const newHash = await bcrypt.hash(newPassword, 10);

  // This also logs out every device, including this one...
  const user = await userService.updatePassword(id, newHash);
  if (!user) {
    throw sessionEnded();
  }

  res.json({
    success: true,
    message: "Password changed. You've been logged out on all other devices",
    // ...so send this device a fresh token to stay logged in
    data: { token: createToken(user) }
  });
};

// POST /auth/logout-all — e.g. "I lost my phone"
export const logoutAll = async (req: Request, res: Response): Promise<void> => {

  await userService.bumpTokenVersion(currentUser(req).id);

  res.json({
    success: true,
    message: "Logged out on all devices"
  });
};
