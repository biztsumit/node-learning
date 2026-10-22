import { Router } from "express";
import { getAuditLog } from "../controllers/audit.controllers.ts";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.ts";
import { validate } from "../middlewares/validate.middleware.ts";
import { auditLogQuerySchema } from "../validators/audit.validators.ts";

const router = Router();

// Admins only, and read-only: nobody can change the log through the API (or the database)
router.use(requireAuth, requireAdmin);

router.get("/", validate({ query: auditLogQuerySchema }), getAuditLog);

export default router;
