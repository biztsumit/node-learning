import { Router } from "express";
import {
  getCategories,
  getCategory,
  addCategory,
  updateCategory,
  deleteCategory
} from "../controllers/category.controllers.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.ts";
import { clearCatalogCacheOnWrite } from "../middlewares/cache.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { idParamSchema } from "../validators/common.validators.js";
import { categorySchema } from "../validators/category.validators.js";

const router = Router();

// Any successful change to categories clears the catalog cache
router.use(clearCatalogCacheOnWrite);

// Public
router.get("/", getCategories);
router.get("/:id", validate({ params: idParamSchema }), getCategory);

// Admin only
router.post("/", requireAuth, requireAdmin, validate({ body: categorySchema }), addCategory);
router.put("/:id", requireAuth, requireAdmin, validate({ params: idParamSchema, body: categorySchema }), updateCategory);
router.delete("/:id", requireAuth, requireAdmin, validate({ params: idParamSchema }), deleteCategory);

export default router;
