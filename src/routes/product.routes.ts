import { Router } from "express";
import {
  getProducts,
  getProduct,
  getProductBySlug,
  addProduct,
  updateProduct,
  deleteProduct
} from "../controllers/product.controllers.ts";
import { setImage } from "../controllers/upload.controllers.ts";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.ts";
import { clearCatalogCacheOnWrite } from "../middlewares/cache.middleware.ts";
import { requireUploadsEnabled } from "../middlewares/uploads.middleware.ts";
import { validate } from "../middlewares/validate.middleware.ts";
import { idParamSchema, slugParamSchema } from "../validators/common.validators.ts";
import { productSchema, productUpdateSchema, productListQuerySchema } from "../validators/product.validators.ts";
import { createVariantSchema, updateVariantSchema, variantParamsSchema } from "../validators/variant.validators.ts";
import { getVariants, addVariant, editVariant, removeVariant } from "../controllers/variant.controllers.ts";
import { productImageSchema } from "../validators/upload.validators.ts";
import { productReviewRoutes } from "./review.routes.ts";

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
