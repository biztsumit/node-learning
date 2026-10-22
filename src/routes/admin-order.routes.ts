import { Router } from "express";
import {
  getAllOrders,
  getAnyOrder,
  updateOrderStatus
} from "../controllers/order.controllers.ts";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.ts";
import { validate } from "../middlewares/validate.middleware.ts";
import { idParamSchema } from "../validators/common.validators.ts";
import {
  adminOrderListQuerySchema,
  updateOrderStatusSchema
} from "../validators/order.validators.ts";

const router = Router();

// Admins only: can see and update every customer's orders
router.use(requireAuth, requireAdmin);

router.get("/", validate({ query: adminOrderListQuerySchema }), getAllOrders);
router.get("/:id", validate({ params: idParamSchema }), getAnyOrder);
router.patch("/:id/status", validate({ params: idParamSchema, body: updateOrderStatusSchema }), updateOrderStatus);

export default router;
