import { Router } from "express";
import {
  getProducts,
  getProduct,
  addProduct,
  updateProduct,
  deleteProduct
} from "../controllers/product.controllers.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { idParamSchema } from "../validators/common.validators.js";
import { productSchema } from "../validators/product.validators.js";

const router = Router();

// Public
router.get("/", getProducts);
router.get("/:id", validate({ params: idParamSchema }), getProduct);

// Admin only
router.post("/", requireAuth, requireAdmin, validate({ body: productSchema }), addProduct);
router.put("/:id", requireAuth, requireAdmin, validate({ params: idParamSchema, body: productSchema }), updateProduct);
router.delete("/:id", requireAuth, requireAdmin, validate({ params: idParamSchema }), deleteProduct);

export default router;
