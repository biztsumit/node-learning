import { Router } from "express";
import { signProductImageUpload } from "../controllers/upload.controllers.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.js";
import { requireUploadsEnabled } from "../middlewares/uploads.middleware.js";

// Mounted at /admin/uploads
const router = Router();

router.use(requireAuth, requireAdmin, requireUploadsEnabled);

router.post("/product-image", signProductImageUpload);

export default router;
