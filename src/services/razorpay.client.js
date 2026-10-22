// Everything that talks to Razorpay lives in this one file.
// Docs: https://razorpay.com/docs/api/orders/ and https://razorpay.com/docs/webhooks/
import crypto from "node:crypto";
import { env } from "../config/env.ts";

const API_URL = "https://api.razorpay.com/v1";

// One authenticated call to Razorpay's API. Throws if Razorpay says no or doesn't answer.
const razorpayRequest = async (method, path, body, what) => {
  const credentials = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64");

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${credentials}`
    },
    body: body && JSON.stringify(body),
    // Don't let a slow payment provider hang our request forever
    signal: AbortSignal.timeout(10_000)
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Razorpay ${what} failed (${response.status}): ${json.error?.description ?? "unknown error"}`);
  }

  return json;
};

// Asks Razorpay to create a payment request ("order" in Razorpay's words) for this amount.
// amount is in paise. Returns e.g. { id: "order_Nx8...", amount: 79900, currency: "INR", status: "created" }
export const createRazorpayOrder = ({ amount, currency, receipt, notes }) =>
  razorpayRequest("POST", "/orders", { amount, currency, receipt, notes }, "order creation");

// Gives money back for a captured payment. Returns e.g.
// { id: "rfnd_Nx9...", payment_id: "pay_...", amount: 79900, status: "pending" | "processed" | "failed" }
// Docs: https://razorpay.com/docs/api/refunds/
export const createRefund = (paymentId, { amount, receipt, notes }) =>
  razorpayRequest("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, { amount, speed: "normal", receipt, notes }, "refund");

// Every refund Razorpay has for a payment (used to check before trying again)
export const listRefunds = async (paymentId) =>
  (await razorpayRequest("GET", `/payments/${encodeURIComponent(paymentId)}/refunds`, undefined, "refund lookup")).items ?? [];

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
