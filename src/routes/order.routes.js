import { Router } from "express";
import {
  placeOrder,
  getMyOrders,
  getMyOrder,
  getMyOrderByNumber,
  cancelMyOrder
} from "../controllers/order.controllers.js";
import { startOrderPayment, verifyOrderPayment } from "../controllers/payment.controllers.js";
import { requireAuth } from "../middlewares/auth.middleware.ts";
import { idempotency } from "../middlewares/idempotency.middleware.js";
import { requirePaymentsEnabled } from "../middlewares/payments.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { idParamSchema } from "../validators/common.validators.js";
import { checkoutSchema, orderListQuerySchema, orderNumberParamSchema } from "../validators/order.validators.js";
import { verifyPaymentSchema } from "../validators/payment.validators.js";

const router = Router();

// Customers: every route here works on the logged-in user's own orders only
router.use(requireAuth);

// Idempotency-Key: a retried checkout returns the first order instead of placing a second one
router.post("/", idempotency, validate({ body: checkoutSchema }), placeOrder);
router.get("/", validate({ query: orderListQuerySchema }), getMyOrders);
router.get("/number/:orderNumber", validate({ params: orderNumberParamSchema }), getMyOrderByNumber);
router.get("/:id", validate({ params: idParamSchema }), getMyOrder);
router.post("/:id/cancel", validate({ params: idParamSchema }), cancelMyOrder);

// Paying for an order with Razorpay
router.post("/:id/payment", requirePaymentsEnabled, validate({ params: idParamSchema }), startOrderPayment);
router.post("/:id/payment/verify", requirePaymentsEnabled, validate({ params: idParamSchema, body: verifyPaymentSchema }), verifyOrderPayment);

export default router;
