// Everything that talks to Razorpay lives in this one file.
// Docs: https://razorpay.com/docs/api/orders/ and https://razorpay.com/docs/webhooks/
import crypto from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.ts";

const API_URL = "https://api.razorpay.com/v1";

// What Razorpay sends back, checked when it arrives. Like a request body, an API's answer is
// data from OUTSIDE our code: if it ever changed shape, we want a clear error right here,
// not an "undefined" turning up somewhere far away. Only the fields we use are listed.
const razorpayOrderSchema = z.object({
  id: z.string(),
  amount: z.number(),
  currency: z.string(),
  status: z.string()
});

const razorpayRefundSchema = z.object({
  id: z.string(),
  payment_id: z.string(),
  amount: z.number(),
  status: z.string()      // "pending" | "processed" | "failed"
});

const razorpayPaymentSchema = z.object({
  id: z.string(),
  amount: z.number(),
  status: z.string()      // "created" | "authorized" | "captured" | "refunded" | "failed"
});

export type RazorpayOrder = z.infer<typeof razorpayOrderSchema>;
export type RazorpayPayment = z.infer<typeof razorpayPaymentSchema>;
export type RazorpayRefund = z.infer<typeof razorpayRefundSchema>;

// Payments are optional (the app runs without them: payment routes answer 503), so these
// settings may be missing. TypeScript makes us handle that case instead of sending "undefined".
const setting = (value: string | undefined, name: string): string => {
  if (!value) {
    throw new Error(`Razorpay isn't configured: ${name} is missing`);
  }
  return value;
};

// One authenticated call to Razorpay's API. Throws if Razorpay says no or doesn't answer.
// The schema both checks the answer and gives it its type (z.ZodType<T> → returns T).
const razorpayRequest = async <T>(
  method: "GET" | "POST",
  path: string,
  body: Record<string, unknown> | undefined,
  what: string,
  schema: z.ZodType<T>
): Promise<T> => {
  const keyId = setting(env.RAZORPAY_KEY_ID, "RAZORPAY_KEY_ID");
  const keySecret = setting(env.RAZORPAY_KEY_SECRET, "RAZORPAY_KEY_SECRET");
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

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

  const json: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    const description = z.object({ error: z.object({ description: z.string() }) }).safeParse(json);
    throw new Error(`Razorpay ${what} failed (${response.status}): ${description.success ? description.data.error.description : "unknown error"}`);
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Razorpay ${what}: unexpected response (${parsed.error.issues.map((i) => i.path.join(".")).join(", ")})`);
  }
  return parsed.data;
};

// Asks Razorpay to create a payment request ("order" in Razorpay's words) for this amount.
// amount is in paise. Returns e.g. { id: "order_Nx8...", amount: 79900, currency: "INR", status: "created" }
export const createRazorpayOrder = (
  { amount, currency, receipt, notes }: { amount: number; currency: string; receipt: string; notes?: Record<string, string> }
): Promise<RazorpayOrder> =>
  razorpayRequest("POST", "/orders", { amount, currency, receipt, notes }, "order creation", razorpayOrderSchema);

// Gives money back for a captured payment. Returns e.g.
// { id: "rfnd_Nx9...", payment_id: "pay_...", amount: 79900, status: "pending" | "processed" | "failed" }
// Docs: https://razorpay.com/docs/api/refunds/
export const createRefund = (
  paymentId: string,
  { amount, receipt, notes }: { amount: number; receipt: string; notes?: Record<string, string> }
): Promise<RazorpayRefund> =>
  razorpayRequest(
    "POST", `/payments/${encodeURIComponent(paymentId)}/refund`,
    { amount, speed: "normal", receipt, notes }, "refund", razorpayRefundSchema
  );

// Every refund Razorpay has for a payment (used to check before trying again)
export const listRefunds = async (paymentId: string): Promise<RazorpayRefund[]> =>
  (await razorpayRequest(
    "GET", `/payments/${encodeURIComponent(paymentId)}/refunds`, undefined, "refund lookup",
    z.object({ items: z.array(razorpayRefundSchema).default([]) })
  )).items;

// Every payment attempt for one of our Razorpay orders (to check what really happened)
export const listOrderPayments = async (razorpayOrderId: string): Promise<RazorpayPayment[]> =>
  (await razorpayRequest(
    "GET", `/orders/${encodeURIComponent(razorpayOrderId)}/payments`, undefined, "payment lookup",
    z.object({ items: z.array(razorpayPaymentSchema).default([]) })
  )).items;

const hmacSha256Hex = (secret: string, data: string | Buffer): string =>
  crypto.createHmac("sha256", secret).update(data).digest("hex");

// Compares in constant time, so an attacker can't guess a signature by timing our replies
const safeEqual = (expected: string, received: unknown): boolean => {
  const a = Buffer.from(expected);
  const b = Buffer.from(String(received ?? ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// After paying, Razorpay Checkout gives the browser a signature. Only someone who knows our
// key secret (Razorpay, or us) can produce it, so a valid one proves the payment is real.
export const isValidPaymentSignature = (
  { razorpayOrderId, razorpayPaymentId, razorpaySignature }: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }
): boolean =>
  safeEqual(
    hmacSha256Hex(setting(env.RAZORPAY_KEY_SECRET, "RAZORPAY_KEY_SECRET"), `${razorpayOrderId}|${razorpayPaymentId}`),
    razorpaySignature
  );

// Webhooks are signed with the webhook secret over the EXACT bytes of the request body
export const isValidWebhookSignature = (rawBody: Buffer, signature: unknown): boolean =>
  safeEqual(hmacSha256Hex(setting(env.RAZORPAY_WEBHOOK_SECRET, "RAZORPAY_WEBHOOK_SECRET"), rawBody), signature);
