import { Router } from "express";
import { getUsers, updateUserRole } from "../controllers/user.controllers.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { idParamSchema } from "../validators/common.validators.js";
import { roleSchema } from "../validators/audit.validators.js";

const router = Router();

// Admin only
router.use(requireAuth, requireAdmin);

router.get("/", getUsers);
router.patch("/:id/role", validate({ params: idParamSchema, body: roleSchema }), updateUserRole);

export default router;
