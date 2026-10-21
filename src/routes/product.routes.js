import { Router } from "express";
import {
  getProducts,
  getProduct,
  getProductBySlug,
  addProduct,
  updateProduct,
  deleteProduct
} from "../controllers/product.controllers.js";
import { setImage } from "../controllers/upload.controllers.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.js";
import { clearCatalogCacheOnWrite } from "../middlewares/cache.middleware.js";
import { requireUploadsEnabled } from "../middlewares/uploads.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { idParamSchema, slugParamSchema } from "../validators/common.validators.js";
import { productSchema, productUpdateSchema, productListQuerySchema } from "../validators/product.validators.js";
import { createVariantSchema, updateVariantSchema, variantParamsSchema } from "../validators/variant.validators.js";
import { getVariants, addVariant, editVariant, removeVariant } from "../controllers/variant.controllers.js";
import { productImageSchema } from "../validators/upload.validators.js";
import { productReviewRoutes } from "./review.routes.js";

const router = Router();

// Any successful change to products (or their reviews) clears the catalog cache
router.use(clearCatalogCacheOnWrite);

// Reviews live under each product: /products/:id/reviews
router.use("/:id/reviews", productReviewRoutes);

// Public
router.get("/", validate({ query: productListQuerySchema }), getProducts);
router.get("/slug/:slug", validate({ params: slugParamSchema }), getProductBySlug);
router.get("/:id", validate({ params: idParamSchema }), getProduct);
router.get("/:id/variants", validate({ params: idParamSchema }), getVariants);

// Admin only
router.post("/", requireAuth, requireAdmin, validate({ body: productSchema }), addProduct);
router.put("/:id", requireAuth, requireAdmin, validate({ params: idParamSchema, body: productUpdateSchema }), updateProduct);
router.delete("/:id", requireAuth, requireAdmin, validate({ params: idParamSchema }), deleteProduct);
router.patch("/:id/image", requireAuth, requireAdmin, requireUploadsEnabled, validate({ params: idParamSchema, body: productImageSchema }), setImage);

// Variants (admin): sizes, colours... each with its own price and stock
router.post("/:id/variants", requireAuth, requireAdmin, validate({ params: idParamSchema, body: createVariantSchema }), addVariant);
router.patch("/:id/variants/:variantId", requireAuth, requireAdmin, validate({ params: variantParamsSchema, body: updateVariantSchema }), editVariant);
router.delete("/:id/variants/:variantId", requireAuth, requireAdmin, validate({ params: variantParamsSchema }), removeVariant);

export default router;
