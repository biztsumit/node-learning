import { Router } from "express";
import {
  getReviews,
  addReview,
  editMyReview,
  removeMyReview,
  removeAnyReview
} from "../controllers/review.controllers.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.ts";
import { clearCatalogCacheOnWrite } from "../middlewares/cache.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { idParamSchema } from "../validators/common.validators.js";
import {
  createReviewSchema,
  updateReviewSchema,
  reviewListQuerySchema
} from "../validators/review.validators.js";

// Mounted at /products/:id/reviews. mergeParams lets this router see :id from the parent path.
export const productReviewRoutes = Router({ mergeParams: true });

productReviewRoutes.use(validate({ params: idParamSchema }));

// Public
productReviewRoutes.get("/", validate({ query: reviewListQuerySchema }), getReviews);

// Customers: their own review of this product
productReviewRoutes.post("/", requireAuth, validate({ body: createReviewSchema }), addReview);
productReviewRoutes.patch("/me", requireAuth, validate({ body: updateReviewSchema }), editMyReview);
productReviewRoutes.delete("/me", requireAuth, removeMyReview);

// Mounted at /admin/reviews
export const adminReviewRoutes = Router();

adminReviewRoutes.use(requireAuth, requireAdmin, clearCatalogCacheOnWrite);
adminReviewRoutes.delete("/:id", validate({ params: idParamSchema }), removeAnyReview);
