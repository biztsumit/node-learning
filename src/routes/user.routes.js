import { Router } from "express";
import { getUsers } from "../controllers/user.controllers.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.js";

const router = Router();

// Admin only
router.get("/", requireAuth, requireAdmin, getUsers);

export default router;
