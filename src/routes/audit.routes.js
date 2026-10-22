import { Router } from "express";
import { getAuditLog } from "../controllers/audit.controllers.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { auditLogQuerySchema } from "../validators/audit.validators.js";

const router = Router();

// Admins only, and read-only: nobody can change the log through the API (or the database)
router.use(requireAuth, requireAdmin);

router.get("/", validate({ query: auditLogQuerySchema }), getAuditLog);

export default router;
