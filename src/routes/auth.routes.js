import { Router } from "express";
import {
  register,
  login,
  getMe,
  updateMe,
  changePassword,
  logoutAll,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification
} from "../controllers/auth.controllers.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { emailLimiter, failedLoginLimiter, signupLimiter } from "../middlewares/security.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema
} from "../validators/auth.validators.js";

const router = Router();

// Public. The limiters come first, so blocked requests never reach the (slow) password hashing.
router.post("/register", signupLimiter, validate({ body: registerSchema }), register);
router.post("/login", failedLoginLimiter, validate({ body: loginSchema }), login);

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

export default router;
