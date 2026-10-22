import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import * as accountService from "../services/account.services.ts";
import * as userService from "../services/user.services.ts";
import * as sessionService from "../services/session.services.ts";
import * as twoFactorService from "../services/two-factor.services.ts";
import { env } from "../config/env.ts";
import { logger } from "../config/logger.ts";
import { AppError } from "../utils/app-error.ts";
import { PG_UNIQUE_VIOLATION, isDatabaseError } from "../utils/db-errors.ts";
import { REFRESH_COOKIE, clearRefreshCookie, readCookie, setRefreshCookie } from "../utils/cookies.ts";
import { currentUser } from "../middlewares/auth.middleware.ts";
import { idSchema } from "../validators/common.validators.ts";
import type { Checked } from "../types/http.ts";
import type {
  ChangePassword, DisableTwoFactor, EnableTwoFactor, ForgotPassword, Login, LoginTwoFactor,
  Register, ResetPassword, UpdateProfile, VerifyEmail
} from "../validators/auth.validators.ts";

type NoParams = Record<string, never>;

// The account was deleted while this request was running (or never existed)
const sessionEnded = () => new AppError(401, "Your session has ended. Please log in again");

// Sends a new session: the refresh token as an httpOnly cookie, the access token in the body.
// "token" keeps its old name, so apps that only use the access token keep working.
const sendSession = (
  res: Response,
  status: number,
  session: sessionService.IssuedSession,
  user: Record<string, unknown>
): void => {
  setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
  res.status(status).json({
    success: true,
    data: { user, token: session.accessToken, accessTokenExpiresIn: env.JWT_EXPIRES_IN }
  });
};

// ---------- Two-step login: the challenge between password and code ----------

// After a correct password, for an account with 2FA on: a short-lived token that says
// "this person knows the password". It's NOT an access token: its audience is different,
// so requireAuth refuses it (see ACCESS_AUDIENCE).
const CHALLENGE_AUDIENCE = "2fa-login";

const challengeSchema = z.object({ userId: idSchema("userId"), tokenVersion: z.number().int() });

const createChallenge = (user: { id: string; token_version: number }): string =>
  jwt.sign({ userId: user.id, tokenVersion: user.token_version }, env.JWT_SECRET, { audience: CHALLENGE_AUDIENCE, expiresIn: "5m" });

const readChallenge = (token: string): z.infer<typeof challengeSchema> => {
  try {
    const parsed = challengeSchema.safeParse(jwt.verify(token, env.JWT_SECRET, { audience: CHALLENGE_AUDIENCE }));
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // expired, tampered with, or not a challenge token
  }
  throw new AppError(401, "This login attempt has expired. Please log in again");
};

// ---------- Register and log in ----------

export const register = async (req: Checked<NoParams, Register>, res: Response): Promise<void> => {

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

  const session = await sessionService.startSession({ ...user, token_version: 0 }, { mfa: false, userAgent: req.get("user-agent") });
  sendSession(res, 201, session, { ...user, email_verified: false });
};

// POST /auth/login. With two-factor on, the password alone isn't enough: the answer is a
// challenge for POST /auth/login/2fa instead of tokens.
export const login = async (req: Checked<NoParams, Login>, res: Response): Promise<void> => {

  const { email, password } = req.body;

  const user = await userService.findUserByEmail(email);

  // "!user ||": TypeScript only knows user exists below because this check says so
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, "Invalid email or password");
  }

  if (user.totp_enabled_at) {
    res.json({
      success: true,
      data: { twoFactorRequired: true, challengeToken: createChallenge(user) }
    });
    return;
  }

  const session = await sessionService.startSession(user, { mfa: false, userAgent: req.get("user-agent") });
  sendSession(res, 200, session, { id: user.id, name: user.name, email: user.email, role: user.role });
};

// POST /auth/login/2fa  { challengeToken, code }: the second step
export const loginWithTwoFactor = async (req: Checked<NoParams, LoginTwoFactor>, res: Response): Promise<void> => {

  const challenge = readChallenge(req.body.challengeToken);
  const user = await userService.findUserById(challenge.userId);
  const state = await userService.getAuthState(challenge.userId);
  // The password may have changed (or every session been ended) since the first step
  if (!user || !state || state.token_version !== challenge.tokenVersion) {
    throw new AppError(401, "This login attempt has expired. Please log in again");
  }

  if (!(await twoFactorService.verifySecondFactor(user.id, req.body.code))) {
    throw new AppError(401, "That code isn't right");
  }

  const session = await sessionService.startSession(
    { id: user.id, role: user.role, token_version: state.token_version },
    { mfa: true, userAgent: req.get("user-agent") }
  );
  sendSession(res, 200, session, { id: user.id, name: user.name, email: user.email, role: user.role });
};

// ---------- Sessions ----------

// POST /auth/refresh (the cookie is sent by the browser): a new access token, and a new
// refresh token in place of the old one
export const refresh = async (req: Request, res: Response): Promise<void> => {

  const refreshToken = readCookie(req.headers.cookie, REFRESH_COOKIE);
  if (!refreshToken) {
    throw new AppError(401, "Not logged in");
  }

  let session: sessionService.IssuedSession;
  try {
    session = await sessionService.refreshSession(refreshToken, req.get("user-agent"));
  } catch (err) {
    // An ended session's cookie is useless: tell the browser to drop it
    if (err instanceof AppError && err.statusCode === 401) {
      clearRefreshCookie(res);
    }
    throw err;
  }

  setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
  res.json({
    success: true,
    data: { token: session.accessToken, accessTokenExpiresIn: env.JWT_EXPIRES_IN }
  });
};

// POST /auth/logout: ends this session (the one the cookie belongs to)
export const logout = async (req: Request, res: Response): Promise<void> => {

  const refreshToken = readCookie(req.headers.cookie, REFRESH_COOKIE);
  if (refreshToken) {
    await sessionService.endSession(refreshToken);
  }
  clearRefreshCookie(res);

  res.json({
    success: true,
    message: "Logged out"
  });
};

// POST /auth/logout-all — e.g. "I lost my phone": every access token AND every session ends
export const logoutAll = async (req: Request, res: Response): Promise<void> => {

  const { id } = currentUser(req);
  await userService.bumpTokenVersion(id);
  await sessionService.endAllSessions(id);
  clearRefreshCookie(res);

  res.json({
    success: true,
    message: "Logged out on all devices"
  });
};

// ---------- Email links ----------

// POST /auth/forgot-password  { email }
// Always the same answer, whether or not the email has an account. Otherwise this form
// would tell anyone which email addresses are customers of the shop.
export const forgotPassword = async (req: Checked<NoParams, ForgotPassword>, res: Response): Promise<void> => {

  await accountService.requestPasswordReset(req.body.email);

  res.json({
    success: true,
    message: "If an account exists for that email, we've sent a link to reset the password"
  });
};

// POST /auth/reset-password  { token, newPassword }
export const resetPassword = async (req: Checked<NoParams, ResetPassword>, res: Response): Promise<void> => {

  await accountService.resetPassword(req.body.token, req.body.newPassword);

  res.json({
    success: true,
    message: "Password changed. You've been logged out everywhere; log in with the new password"
  });
};

// POST /auth/verify-email  { token }
export const verifyEmail = async (req: Checked<NoParams, VerifyEmail>, res: Response): Promise<void> => {

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

// ---------- My account ----------

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
export const updateMe = async (req: Checked<NoParams, UpdateProfile>, res: Response): Promise<void> => {

  const user = await userService.updateUserName(currentUser(req).id, req.body.name);

  res.json({
    success: true,
    data: user
  });
};

// POST /auth/change-password  { currentPassword, newPassword }
export const changePassword = async (req: Checked<NoParams, ChangePassword>, res: Response): Promise<void> => {

  const { currentPassword, newPassword } = req.body;
  const { id, mfa } = currentUser(req);

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
  await sessionService.endAllSessions(id);

  // ...so this device gets a fresh session to stay logged in (as two-factor as it was)
  const session = await sessionService.startSession(user, { mfa, userAgent: req.get("user-agent") });
  setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
  res.json({
    success: true,
    message: "Password changed. You've been logged out on all other devices",
    data: { token: session.accessToken, accessTokenExpiresIn: env.JWT_EXPIRES_IN }
  });
};

// ---------- Two-factor login ----------

// GET /auth/2fa
export const getTwoFactorStatus = async (req: Request, res: Response): Promise<void> => {
  res.json({
    success: true,
    data: await twoFactorService.getStatus(currentUser(req).id)
  });
};

// POST /auth/2fa/setup: the secret to add to an authenticator app
export const setupTwoFactor = async (req: Request, res: Response): Promise<void> => {
  res.json({
    success: true,
    data: await twoFactorService.beginSetup(currentUser(req).id)
  });
};

// POST /auth/2fa/enable  { code }
export const enableTwoFactor = async (req: Checked<NoParams, EnableTwoFactor>, res: Response): Promise<void> => {
  const { recoveryCodes } = await twoFactorService.enable(currentUser(req).id, req.body.code);
  res.json({
    success: true,
    message: "Two-factor login is on. Save these recovery codes somewhere safe: each works once, and they won't be shown again",
    data: { recoveryCodes }
  });
};

// POST /auth/2fa/disable  { password, code }
export const disableTwoFactor = async (req: Checked<NoParams, DisableTwoFactor>, res: Response): Promise<void> => {
  await twoFactorService.disable(currentUser(req).id, req.body);
  res.json({
    success: true,
    message: "Two-factor login is off"
  });
};
