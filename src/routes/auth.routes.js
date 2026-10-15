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
import { validate } from "../middlewares/validate.middleware.js";
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema
} from "../validators/auth.validators.js";

const router = Router();

// Public
router.post("/register", validate({ body: registerSchema }), register);
router.post("/login", validate({ body: loginSchema }), login);

// Private
router.get("/me", requireAuth, getMe);
router.patch("/me", requireAuth, validate({ body: updateProfileSchema }), updateMe);
router.post("/change-password", requireAuth, validate({ body: changePasswordSchema }), changePassword);
router.post("/logout-all", requireAuth, logoutAll);

export default router;
