import { Router } from "express";
import { register, login, getMe } from "../controllers/auth.controllers.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { registerSchema, loginSchema } from "../validators/auth.validators.js";

const router = Router();

// Public
router.post("/register", validate({ body: registerSchema }), register);
router.post("/login", validate({ body: loginSchema }), login);

// Private
router.get("/me", requireAuth, getMe);

export default router;
