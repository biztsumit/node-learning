import { Router } from "express";
import { signProductImageUpload } from "../controllers/upload.controllers.ts";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.ts";
import { requireUploadsEnabled } from "../middlewares/uploads.middleware.ts";

// Mounted at /admin/uploads
const router = Router();

router.use(requireAuth, requireAdmin, requireUploadsEnabled);

router.post("/product-image", signProductImageUpload);

export default router;
