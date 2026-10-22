import { z } from "zod";
import { env } from "../config/env.ts";
import { logger } from "../config/logger.ts";
import { withTransaction, type TransactionClient } from "../db/transaction.ts";
import { AppError } from "../utils/app-error.ts";
import { enqueue } from "../jobs/queue.ts";
import * as razorpay from "./razorpay.client.ts";
import { processRefund, recordRefundEvent, requestRefund } from "./refund.services.ts";
import type { VerifyPayment } from "../validators/payment.validators.ts";

// Our prices are whole rupees; Razorpay works in paise (1 rupee = 100 paise)
const toPaise = (rupees: number): number => rupees * 100;

// What the frontend needs to open Razorpay Checkout
export type CheckoutDetails = {
  orderId: string;
  keyId: string | undefined;
  razorpayOrderId: string;
  amount: number;
  currency: string;
  prefill: { name: string; email: string; contact: string | null };
};

type PaymentRequest = { provider_order_id: string; amount: number; currency: string };

// ---------- Step 1: the customer clicks "Pay" ----------

// Creates (or reuses) a Razorpay payment request for one of the user's pending orders,
// and returns what the frontend needs to open Razorpay Checkout.
export const startPayment = async (userId: string, orderId: string): Promise<CheckoutDetails> => {

  return withTransaction(async (client) => {

    // Lock the order: two "Pay" clicks at once must not create two payment requests
    const { rows: [order] } = await client.query<{
      id: string; order_number: string; status: string; total_amount: number; phone: string | null;
      expired: boolean; name: string; email: string;
    }>(
      `SELECT o.id, o.order_number, o.status, o.total_amount, o.shipping_address->>'phone' AS phone,
              o.created_at < NOW() - make_interval(mins => $3) AS expired,
              u.name, u.email
       FROM orders o
       JOIN users u ON u.id = o.user_id
       WHERE o.id = $1 AND o.user_id = $2
       FOR UPDATE OF o`,
      [orderId, userId, env.ORDER_PAYMENT_TIMEOUT_MINUTES]
    );

    if (!order) {
      throw new AppError(404, "Order not found");
    }
    if (order.status !== "pending") {
      throw new AppError(409, `This order is ${order.status}, so it can't be paid`);
    }
    // The expiry job runs every minute; don't start a payment in the gap before it gets here
    if (order.expired) {
      throw new AppError(409, "The time to pay for this order has run out. Please place the order again");
    }

    const amount = toPaise(order.total_amount);

    // Reuse an unfinished attempt instead of creating a new one on every click
    const { rows: [existing] } = await client.query<PaymentRequest>(
      `SELECT provider_order_id, amount, currency FROM payments
       WHERE order_id = $1 AND status = 'created' AND amount = $2
       ORDER BY id DESC LIMIT 1`,
      [order.id, amount]
    );

    let payment = existing;

    if (!payment) {
      let razorpayOrder: razorpay.RazorpayOrder;
      try {
        razorpayOrder = await razorpay.createRazorpayOrder({
          amount,
          currency: "INR",
          // Shown in Razorpay's dashboard, so use the number people quote (max 40 characters)
          receipt: order.order_number,
          notes: { orderId: order.id, orderNumber: order.order_number }
        });
      } catch (err) {
        logger.error({ err, orderId: order.id }, "Razorpay order creation failed");
        throw new AppError(502, "Could not reach the payment provider. Please try again");
      }

      const { rows: [created] } = await client.query<PaymentRequest>(
        `INSERT INTO payments (order_id, provider_order_id, amount, currency)
         VALUES ($1, $2, $3, $4)
         RETURNING provider_order_id, amount, currency`,
        [order.id, razorpayOrder.id, razorpayOrder.amount, razorpayOrder.currency]
      );
      if (!created) {
        throw new Error("Expected the new payment row");
      }
      payment = created;
    }

    // Everything Razorpay Checkout (in the browser) needs. The key id is public; the secret never leaves the server.
    return {
      orderId: order.id,
      keyId: env.RAZORPAY_KEY_ID,
      razorpayOrderId: payment.provider_order_id,
      amount: payment.amount,
      currency: payment.currency,
      prefill: { name: order.name, email: order.email, contact: order.phone }
    };
  });
};

// ---------- Recording a successful payment (used by both step 2 and webhooks) ----------

// A DISCRIMINATED UNION: one of these shapes, told apart by "result". After a check like
// `if (outcome.result === "needs_refund")`, TypeScript knows refundId exists; on other
// outcomes, reading it is a type error. Every possible outcome is listed in one place.
type PaymentOutcome =
  | { result: "unknown_payment" }
  | { result: "already_paid"; orderId: string }
  | { result: "amount_mismatch"; orderId: string }
  | { result: "paid"; orderId: string }
  | { result: "needs_refund"; orderId: string; refundId: string | null };

// Marks the payment, and its order, as paid. Safe to call many times for the same payment:
// the browser and Razorpay's webhooks will usually BOTH report the same payment.
// amount is only known from webhooks; the browser's report is proven by its signature instead.
// TransactionClient (not just PoolClient): it queues an email, which needs the transaction's afterCommit
const recordSuccessfulPayment = async (
  client: TransactionClient,
  { providerOrderId, providerPaymentId, amount }: { providerOrderId: string; providerPaymentId: string; amount?: number }
): Promise<PaymentOutcome> => {

  const { rows: [payment] } = await client.query<{ id: string; order_id: string; amount: number; status: string }>(
    "SELECT id, order_id, amount, status FROM payments WHERE provider_order_id = $1 FOR UPDATE",
    [providerOrderId]
  );

  if (!payment) {
    return { result: "unknown_payment" };
  }
  if (payment.status === "paid") {
    return { result: "already_paid", orderId: payment.order_id };
  }
  if (amount !== undefined && amount !== payment.amount) {
    logger.error(
      { providerPaymentId, orderId: payment.order_id, paidAmount: amount, expectedAmount: payment.amount },
      "Payment amount doesn't match the order"
    );
    return { result: "amount_mismatch", orderId: payment.order_id };
  }

  await client.query(
    `UPDATE payments SET status = 'paid', provider_payment_id = $1, updated_at = NOW()
     WHERE id = $2`,
    [providerPaymentId, payment.id]
  );

  const { rows: [order] } = await client.query<{ status: string }>(
    "SELECT status FROM orders WHERE id = $1 FOR UPDATE",
    [payment.order_id]
  );

  if (order?.status === "pending") {
    await client.query(
      "UPDATE orders SET status = 'paid', updated_at = NOW() WHERE id = $1",
      [payment.order_id]
    );
    await enqueue("order-email", { orderId: payment.order_id, type: "paid" }, { client });
    return { result: "paid", orderId: payment.order_id };
  }

  // e.g. the order was cancelled while the customer was on the payment screen:
  // the money arrived, but the order isn't active any more, so it's refunded automatically.
  logger.warn(
    { providerPaymentId, orderId: payment.order_id, orderStatus: order?.status, amount: payment.amount },
    "Payment received for an inactive order: refunding it"
  );
  const refundId = await requestRefund(client, payment.id, "paid_after_cancellation");
  return { result: "needs_refund", orderId: payment.order_id, refundId };
};

// ---------- Step 2: the browser reports "payment done" ----------

export const confirmPayment = async (
  userId: string,
  orderId: string,
  { razorpayOrderId, razorpayPaymentId, razorpaySignature }: VerifyPayment
): Promise<void> => {

  // Never trust the browser's word for it: check Razorpay's signature first
  if (!razorpay.isValidPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature })) {
    throw new AppError(400, "Payment verification failed");
  }

  const outcome = await withTransaction(async (client) => {

    // The payment must belong to this order, and the order to this user
    const { rows } = await client.query(
      `SELECT 1 FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.provider_order_id = $1 AND o.id = $2 AND o.user_id = $3`,
      [razorpayOrderId, orderId, userId]
    );

    if (rows.length === 0) {
      throw new AppError(404, "Payment not found");
    }

    return recordSuccessfulPayment(client, {
      providerOrderId: razorpayOrderId,
      providerPaymentId: razorpayPaymentId
    });
  });

  // After the transaction: send the refund to Razorpay, then tell the customer.
  // (Thrown after the transaction, so the payment and refund records stay saved.)
  if (outcome.result === "needs_refund") {
    if (outcome.refundId) {
      await processRefund(outcome.refundId);
    }
    throw new AppError(409, "This order was cancelled before the payment completed. The payment is being refunded");
  }
};

// ---------- Webhooks: Razorpay's server tells our server what happened ----------

// The parts of a webhook we read. Lenient on purpose: Razorpay sends many event types,
// and one we don't use must still be accepted (or Razorpay keeps retrying it).
const webhookEventSchema = z.object({
  event: z.string(),
  payload: z.object({
    payment: z.object({
      // order_id is null for payments not made through a Razorpay order (not ours)
      entity: z.object({ id: z.string(), order_id: z.string().nullable(), amount: z.number() })
    }).optional(),
    refund: z.object({
      entity: z.object({ id: z.string().optional(), payment_id: z.string().optional() })
    }).optional()
  }).optional()
});

export const handleRazorpayWebhook = async (rawBody: Buffer, signature: unknown, eventId: string | undefined): Promise<void> => {

  if (!razorpay.isValidWebhookSignature(rawBody, signature)) {
    throw new AppError(400, "Invalid webhook signature");
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new AppError(400, "Webhook body is not valid JSON");
  }
  // Signed by Razorpay, so this only fails if their format changed: worth a clear 400 (and they'll retry)
  const parsed = webhookEventSchema.safeParse(json);
  if (!parsed.success) {
    throw new AppError(400, "Webhook body has an unexpected shape");
  }
  const event = parsed.data;

  // Refunds to send to Razorpay once this event's changes are committed
  const refundsToSend: string[] = [];

  await withTransaction(async (client) => {

    // Remember the event id. If we've seen it before, it's a repeat delivery: do nothing.
    // This runs in the same transaction as the work below, so if the work fails,
    // the event isn't remembered either and Razorpay's retry will be processed.
    if (eventId) {
      const { rowCount } = await client.query(
        "INSERT INTO webhook_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [eventId, event.event]
      );
      if (rowCount === 0) {
        return;
      }
    }

    const entity = event.payload?.payment?.entity;
    // Only payments for one of our Razorpay orders concern us
    const payment = entity?.order_id ? { ...entity, order_id: entity.order_id } : undefined;

    switch (event.event) {
      case "payment.captured":
      case "order.paid":
        if (payment) {
          const outcome = await recordSuccessfulPayment(client, {
            providerOrderId: payment.order_id,
            providerPaymentId: payment.id,
            amount: payment.amount
          });
          if (outcome.result === "needs_refund" && outcome.refundId) {
            refundsToSend.push(outcome.refundId);
          }
        }
        break;

      case "refund.created":
      case "refund.processed":
      case "refund.failed":
        await recordRefundEvent(client, event.event, event.payload?.refund?.entity);
        break;

      case "payment.failed":
        if (payment) {
          await client.query(
            `UPDATE payments SET status = 'failed', updated_at = NOW()
             WHERE provider_order_id = $1 AND status = 'created'`,
            [payment.order_id]
          );
        }
        break;

      default:
        // An event we don't use: accept it so Razorpay doesn't keep retrying
        break;
    }
  });

  // Not awaited: Razorpay expects a quick reply to webhooks. If sending fails,
  // the refund stays pending and the background job retries it.
  for (const refundId of refundsToSend) {
    processRefund(refundId).catch((err: unknown) => logger.error({ err, refundId }, "Could not send refund"));
  }
};
