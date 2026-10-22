import { Router } from "express";
import { getUsers, updateUserRole } from "../controllers/user.controllers.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.ts";
import { validate } from "../middlewares/validate.middleware.ts";
import { idParamSchema } from "../validators/common.validators.ts";
import { roleSchema } from "../validators/audit.validators.ts";

const router = Router();

// Admin only
router.use(requireAuth, requireAdmin);

router.get("/", getUsers);
router.patch("/:id/role", validate({ params: idParamSchema, body: roleSchema }), updateUserRole);

export default router;
