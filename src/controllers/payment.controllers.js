import * as paymentService from "../services/payment.services.js";
import * as orderService from "../services/order.services.js";

// POST /orders/:id/payment — step 1: get what the frontend needs to open Razorpay Checkout
export const startOrderPayment = async (req, res) => {

  const checkout = await paymentService.startPayment(req.user.id, req.params.id);

  res.json({
    success: true,
    data: checkout
  });
};

// POST /orders/:id/payment/verify — step 2: the browser reports the payment; we check the signature
export const verifyOrderPayment = async (req, res) => {

  await paymentService.confirmPayment(req.user.id, req.params.id, req.body);

  const order = await orderService.getOrderById(req.params.id, { userId: req.user.id });

  res.json({
    success: true,
    data: order
  });
};

// POST /webhooks/razorpay — Razorpay's server calls this; req.body is the raw bytes here
export const razorpayWebhook = async (req, res) => {

  await paymentService.handleRazorpayWebhook(
    req.body,
    req.get("x-razorpay-signature"),
    req.get("x-razorpay-event-id")
  );

  // Answer quickly with 2xx, or Razorpay will think delivery failed and retry
  res.json({ received: true });
};
