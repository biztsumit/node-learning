import express, { Router } from "express";
import { razorpayWebhook } from "../controllers/payment.controllers.ts";
import { requirePaymentsEnabled } from "../middlewares/payments.middleware.ts";

const router = Router();

// No requireAuth: Razorpay's server has no user token. The signature check proves it's Razorpay.
// express.raw keeps the body as the exact bytes Razorpay sent, which the signature is computed over.
router.post(
  "/razorpay",
  requirePaymentsEnabled,
  express.raw({ type: "application/json", limit: "1mb" }),
  razorpayWebhook
);

export default router;
