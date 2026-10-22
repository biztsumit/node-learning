import { Router } from "express";
import {
  getCoupons,
  getCoupon,
  addCoupon,
  editCoupon,
  removeCoupon
} from "../controllers/coupon.controllers.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.ts";
import { validate } from "../middlewares/validate.middleware.js";
import { idParamSchema } from "../validators/common.validators.js";
import {
  couponListQuerySchema,
  createCouponSchema,
  updateCouponSchema
} from "../validators/coupon.validators.js";

const router = Router();

// Admins only: customers use coupons through the cart and checkout
router.use(requireAuth, requireAdmin);

router.get("/", validate({ query: couponListQuerySchema }), getCoupons);
router.post("/", validate({ body: createCouponSchema }), addCoupon);
router.get("/:id", validate({ params: idParamSchema }), getCoupon);
router.patch("/:id", validate({ params: idParamSchema, body: updateCouponSchema }), editCoupon);
router.delete("/:id", validate({ params: idParamSchema }), removeCoupon);

export default router;
