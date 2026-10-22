import { Router } from "express";
import {
  register,
  login,
  getMe,
  updateMe,
  changePassword,
  logoutAll,
  loginWithTwoFactor,
  refresh,
  logout,
  getTwoFactorStatus,
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification
} from "../controllers/auth.controllers.ts";
import { requireAuth } from "../middlewares/auth.middleware.ts";
import { emailLimiter, failedLoginLimiter, requireTrustedOrigin, signupLimiter } from "../middlewares/security.middleware.ts";
import { validate } from "../middlewares/validate.middleware.ts";
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  loginTwoFactorSchema,
  enableTwoFactorSchema,
  disableTwoFactorSchema
} from "../validators/auth.validators.ts";

const router = Router();

// Public. The limiters come first, so blocked requests never reach the (slow) password hashing.
router.post("/register", signupLimiter, validate({ body: registerSchema }), register);
router.post("/login", failedLoginLimiter, validate({ body: loginSchema }), login);
// The second step of a two-factor login. Wrong codes count as failed logins (guessing).
router.post("/login/2fa", failedLoginLimiter, validate({ body: loginTwoFactorSchema }), loginWithTwoFactor);

// The refresh-token cookie: a new access token, or the end of this session
router.post("/refresh", requireTrustedOrigin, refresh);
router.post("/logout", requireTrustedOrigin, logout);

// One-time email links. Wrong tokens count as failed attempts (someone guessing links).
router.post("/forgot-password", emailLimiter, validate({ body: forgotPasswordSchema }), forgotPassword);
router.post("/reset-password", failedLoginLimiter, validate({ body: resetPasswordSchema }), resetPassword);
router.post("/verify-email", failedLoginLimiter, validate({ body: verifyEmailSchema }), verifyEmail);

// Private
router.get("/me", requireAuth, getMe);
router.patch("/me", requireAuth, validate({ body: updateProfileSchema }), updateMe);
router.post("/change-password", failedLoginLimiter, requireAuth, validate({ body: changePasswordSchema }), changePassword);
router.post("/logout-all", requireAuth, logoutAll);
router.post("/resend-verification", emailLimiter, requireAuth, resendVerification);

// Two-factor login (authenticator app codes)
router.get("/2fa", requireAuth, getTwoFactorStatus);
router.post("/2fa/setup", requireAuth, setupTwoFactor);
router.post("/2fa/enable", failedLoginLimiter, requireAuth, validate({ body: enableTwoFactorSchema }), enableTwoFactor);
router.post("/2fa/disable", failedLoginLimiter, requireAuth, validate({ body: disableTwoFactorSchema }), disableTwoFactor);

export default router;
