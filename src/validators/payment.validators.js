import { z } from "zod";

const razorpayId = (label, prefix) => z
  .string({ error: `${label} is required` })
  .trim()
  .min(1, { error: `${label} is required` })
  .max(100, { error: `${label} is too long` })
  .startsWith(prefix, { error: `${label} must start with "${prefix}"` });

// POST /orders/:id/payment/verify — the three values Razorpay Checkout gives the browser
export const verifyPaymentSchema = z.object({
  razorpayOrderId: razorpayId("razorpayOrderId", "order_"),
  razorpayPaymentId: razorpayId("razorpayPaymentId", "pay_"),
  razorpaySignature: z
    .string({ error: "razorpaySignature is required" })
    .regex(/^[a-f0-9]{64}$/, { error: "razorpaySignature must be a 64-character hex string" })
});
