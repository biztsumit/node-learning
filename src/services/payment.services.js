import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { withTransaction } from "../db/transaction.js";
import { AppError } from "../utils/app-error.js";
import * as razorpay from "./razorpay.client.js";

// Our prices are whole rupees; Razorpay works in paise (1 rupee = 100 paise)
const toPaise = (rupees) => rupees * 100;

// ---------- Step 1: the customer clicks "Pay" ----------

// Creates (or reuses) a Razorpay payment request for one of the user's pending orders,
// and returns what the frontend needs to open Razorpay Checkout.
export const startPayment = async (userId, orderId) => {

  return withTransaction(async (client) => {

    // Lock the order: two "Pay" clicks at once must not create two payment requests
    const { rows: [order] } = await client.query(
      `SELECT o.id, o.status, o.total_amount, o.shipping_address->>'phone' AS phone,
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
    const { rows: [existing] } = await client.query(
      `SELECT provider_order_id, amount, currency FROM payments
       WHERE order_id = $1 AND status = 'created' AND amount = $2
       ORDER BY id DESC LIMIT 1`,
      [order.id, amount]
    );

    let payment = existing;

    if (!payment) {
      let razorpayOrder;
      try {
        razorpayOrder = await razorpay.createRazorpayOrder({
          amount,
          currency: "INR",
          // Razorpay allows at most 40 characters here; a UUID is 36
          receipt: order.id,
          notes: { orderId: String(order.id) }
        });
      } catch (err) {
        logger.error({ err, orderId: order.id }, "Razorpay order creation failed");
        throw new AppError(502, "Could not reach the payment provider. Please try again");
      }

      const { rows } = await client.query(
        `INSERT INTO payments (order_id, provider_order_id, amount, currency)
         VALUES ($1, $2, $3, $4)
         RETURNING provider_order_id, amount, currency`,
        [order.id, razorpayOrder.id, razorpayOrder.amount, razorpayOrder.currency]
      );
      payment = rows[0];
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

// Marks the payment, and its order, as paid. Safe to call many times for the same payment:
// the browser and Razorpay's webhooks will usually BOTH report the same payment.
const recordSuccessfulPayment = async (client, { providerOrderId, providerPaymentId, amount }) => {

  const { rows: [payment] } = await client.query(
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

  const { rows: [order] } = await client.query(
    "SELECT status FROM orders WHERE id = $1 FOR UPDATE",
    [payment.order_id]
  );

  if (order.status === "pending") {
    await client.query(
      "UPDATE orders SET status = 'paid', updated_at = NOW() WHERE id = $1",
      [payment.order_id]
    );
    return { result: "paid", orderId: payment.order_id };
  }

  // e.g. the order was cancelled while the customer was on the payment screen:
  // the money arrived, but the order isn't active any more, so it has to be refunded.
  logger.warn(
    { providerPaymentId, orderId: payment.order_id, orderStatus: order.status, amount: payment.amount },
    "Payment received for an inactive order: refund needed"
  );
  return { result: "needs_refund", orderId: payment.order_id };
};

// ---------- Step 2: the browser reports "payment done" ----------

export const confirmPayment = async (userId, orderId, { razorpayOrderId, razorpayPaymentId, razorpaySignature }) => {

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

  // Thrown after the transaction, so the payment itself stays recorded as paid
  if (outcome.result === "needs_refund") {
    throw new AppError(409, "This order was cancelled before the payment completed. The payment will be refunded");
  }
};

// ---------- Webhooks: Razorpay's server tells our server what happened ----------

export const handleRazorpayWebhook = async (rawBody, signature, eventId) => {

  if (!razorpay.isValidWebhookSignature(rawBody, signature)) {
    throw new AppError(400, "Invalid webhook signature");
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new AppError(400, "Webhook body is not valid JSON");
  }

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

    const payment = event.payload?.payment?.entity;

    switch (event.event) {
      case "payment.captured":
      case "order.paid":
        if (payment) {
          await recordSuccessfulPayment(client, {
            providerOrderId: payment.order_id,
            providerPaymentId: payment.id,
            amount: payment.amount
          });
        }
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
};
