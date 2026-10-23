import type { Request, Response } from "express";
import * as paymentService from "../services/payment.services.ts";
import * as orderService from "../services/order.services.ts";
import { currentUser } from "../middlewares/auth.middleware.ts";
import { AppError } from "../utils/app-error.ts";
import type { Checked } from "../types/http.ts";
import type { IdParam } from "../validators/common.validators.ts";
import type { VerifyPayment } from "../validators/payment.validators.ts";

// POST /orders/:id/payment — step 1: get what the frontend needs to open Razorpay Checkout
export const startOrderPayment = async (req: Checked<IdParam>, res: Response): Promise<void> => {

  const checkout = await paymentService.startPayment(currentUser(req).id, req.params.id);

  res.json({
    success: true,
    data: checkout
  });
};

// POST /orders/:id/payment/verify — step 2: the browser reports the payment; we check the signature
export const verifyOrderPayment = async (req: Checked<IdParam, VerifyPayment>, res: Response): Promise<void> => {

  const { id: userId } = currentUser(req);
  await paymentService.confirmPayment(userId, req.params.id, req.body);

  const order = await orderService.getOrderById(req.params.id, { userId });

  res.json({
    success: true,
    data: order
  });
};

// POST /orders/:id/payment/sync — "I paid but it still says pending": ask Razorpay directly
export const syncOrderPayment = async (req: Checked<IdParam>, res: Response): Promise<void> => {

  const { id: userId } = currentUser(req);
  await paymentService.syncOrderPayment(userId, req.params.id);
  const order = await orderService.getOrderById(req.params.id, { userId });

  res.json({
    success: true,
    data: order
  });
};

// POST /webhooks/razorpay — Razorpay's server calls this; req.body is the raw bytes here
// (express.raw in the webhook route), because the signature covers those exact bytes
export const razorpayWebhook = async (req: Request, res: Response): Promise<void> => {

  if (!Buffer.isBuffer(req.body)) {
    throw new AppError(400, "Expected the raw webhook body");
  }

  await paymentService.handleRazorpayWebhook(
    req.body,
    req.get("x-razorpay-signature"),
    req.get("x-razorpay-event-id")
  );

  // Answer quickly with 2xx, or Razorpay will think delivery failed and retry
  res.json({ received: true });
};
