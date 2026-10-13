import { Router } from "express";
import {
  placeOrder,
  getMyOrders,
  getMyOrder,
  cancelMyOrder
} from "../controllers/order.controllers.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { idParamSchema } from "../validators/common.validators.js";
import { orderListQuerySchema } from "../validators/order.validators.js";

const router = Router();

// Customers: every route here works on the logged-in user's own orders only
router.use(requireAuth);

router.post("/", placeOrder);
router.get("/", validate({ query: orderListQuerySchema }), getMyOrders);
router.get("/:id", validate({ params: idParamSchema }), getMyOrder);
router.post("/:id/cancel", validate({ params: idParamSchema }), cancelMyOrder);

export default router;
