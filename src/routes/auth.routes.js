import { Router } from "express";
import {
  register,
  login,
  getMe,
  updateMe,
  changePassword,
  logoutAll
} from "../controllers/auth.controllers.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { failedLoginLimiter, signupLimiter } from "../middlewares/security.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema
} from "../validators/auth.validators.js";

const router = Router();

// Public. The limiters come first, so blocked requests never reach the (slow) password hashing.
router.post("/register", signupLimiter, validate({ body: registerSchema }), register);
router.post("/login", failedLoginLimiter, validate({ body: loginSchema }), login);

// Private
router.get("/me", requireAuth, getMe);
router.patch("/me", requireAuth, validate({ body: updateProfileSchema }), updateMe);
router.post("/change-password", failedLoginLimiter, requireAuth, validate({ body: changePasswordSchema }), changePassword);
router.post("/logout-all", requireAuth, logoutAll);

export default router;
