// Everything that talks to Razorpay lives in this one file.
// Docs: https://razorpay.com/docs/api/orders/ and https://razorpay.com/docs/webhooks/
import crypto from "node:crypto";
import { env } from "../config/env.js";

const API_URL = "https://api.razorpay.com/v1";

// Asks Razorpay to create a payment request ("order" in Razorpay's words) for this amount.
// amount is in paise. Returns e.g. { id: "order_Nx8...", amount: 79900, currency: "INR", status: "created" }
export const createRazorpayOrder = async ({ amount, currency, receipt, notes }) => {
  const credentials = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64");

  const response = await fetch(`${API_URL}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${credentials}`
    },
    body: JSON.stringify({ amount, currency, receipt, notes }),
    // Don't let a slow payment provider hang our request forever
    signal: AbortSignal.timeout(10_000)
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Razorpay order creation failed (${response.status}): ${body.error?.description ?? "unknown error"}`);
  }

  return body;
};

const hmacSha256Hex = (secret, data) =>
  crypto.createHmac("sha256", secret).update(data).digest("hex");

// Compares in constant time, so an attacker can't guess a signature by timing our replies
const safeEqual = (expected, received) => {
  const a = Buffer.from(expected);
  const b = Buffer.from(String(received ?? ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// After paying, Razorpay Checkout gives the browser a signature. Only someone who knows our
// key secret (Razorpay, or us) can produce it, so a valid one proves the payment is real.
export const isValidPaymentSignature = ({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) =>
  safeEqual(
    hmacSha256Hex(env.RAZORPAY_KEY_SECRET, `${razorpayOrderId}|${razorpayPaymentId}`),
    razorpaySignature
  );

// Webhooks are signed with the webhook secret over the EXACT bytes of the request body
export const isValidWebhookSignature = (rawBody, signature) =>
  safeEqual(hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, rawBody), signature);
