// Automatic refunds through Razorpay.
//
// Two steps, on purpose:
//   1. requestRefund(client, ...)  — INSIDE the transaction that decides money must go back
//      (an admin cancelling a paid order, or a payment arriving for a cancelled one).
//      It only writes a "pending" refund row, so the decision and the record commit together.
//   2. processRefund(id)           — AFTER that commit: calls Razorpay. If the call fails,
//      the row simply stays pending and retryPendingRefunds() (the background job) tries again.
// Never call an outside API while you still might roll back: Razorpay can't be rolled back.
import pool from "../config/db.ts";
import { logger } from "../config/logger.ts";
import { withTransaction, type TransactionClient } from "../db/transaction.ts";
import { enqueue } from "../jobs/queue.ts";
import * as razorpay from "./razorpay.client.ts";

// Give up retrying after this many calls; then a person has to look at it (it's logged)
const MAX_ATTEMPTS = 10;

// Must match the CHECKs on the refunds table (migration 016)
export type RefundReason = "order_cancelled" | "paid_after_cancellation";
type RefundStatus = "pending" | "processed" | "failed";

// A refund as Razorpay describes it in a webhook. It comes from outside, so every field may
// be missing: the code checks before using them.
export type RefundWebhookEntity = { id?: string; payment_id?: string } | undefined;

// Step 1. Returns the new refund's id, or null if this payment already has an active refund.
export const requestRefund = async (client: TransactionClient, paymentId: string, reason: RefundReason): Promise<string | null> => {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO refunds (payment_id, amount, reason)
     SELECT id, amount, $2 FROM payments WHERE id = $1 AND status = 'paid'
     ON CONFLICT (payment_id) WHERE status <> 'failed' DO NOTHING
     RETURNING id`,
    [paymentId, reason]
  );
  const refundId = rows[0]?.id ?? null;
  if (refundId) {
    logger.info({ refundId, paymentId, reason }, "Refund requested");
  }
  return refundId;
};

// Marks the payment refunded and, in the same transaction, queues the "refund processed" email
// Needs the transaction (not just a connection): it queues the "refunded" email
const markPaymentRefunded = async (client: TransactionClient, refundId: string): Promise<void> => {
  const { rows: [payment] } = await client.query<{ order_id: string }>(
    `UPDATE payments SET status = 'refunded', updated_at = NOW()
     WHERE id = (SELECT payment_id FROM refunds WHERE id = $1) AND status <> 'refunded'
     RETURNING order_id`,
    [refundId]
  );
  // Only the first time: a repeated "processed" webhook doesn't send a second email
  if (payment) {
    await enqueue("order-email", { orderId: payment.order_id, type: "refunded" }, { client });
  }
};

// Step 2. Safe to call any number of times, from anywhere, even at the same moment.
export const processRefund = async (refundId: string): Promise<void> => {
  await withTransaction(async (client) => {

    // SKIP LOCKED: if another process is already sending this refund, leave it to them
    const { rows: [refund] } = await client.query<{
      id: string; amount: number; status: RefundStatus; provider_refund_id: string | null;
      attempts: number; provider_payment_id: string;
    }>(
      `SELECT r.id, r.amount, r.status, r.provider_refund_id, r.attempts, p.provider_payment_id
       FROM refunds r JOIN payments p ON p.id = r.payment_id
       WHERE r.id = $1
       FOR UPDATE OF r SKIP LOCKED`,
      [refundId]
    );
    if (!refund || refund.status !== "pending" || refund.provider_refund_id) {
      return;   // being handled elsewhere, or already accepted by Razorpay
    }

    try {
      // A previous attempt may have reached Razorpay even though its answer got lost
      // (timeout, crash). Ask first, so a retry can never refund the customer twice.
      const existing = (await razorpay.listRefunds(refund.provider_payment_id))
        .find((r) => r.status !== "failed");

      const accepted = existing ?? await razorpay.createRefund(refund.provider_payment_id, {
        amount: refund.amount,
        receipt: refund.id,                      // our refund id, shown in Razorpay's dashboard
        notes: { refundId: refund.id }
      });

      const status: RefundStatus = accepted.status === "processed" ? "processed" : accepted.status === "failed" ? "failed" : "pending";
      await client.query(
        `UPDATE refunds
         SET provider_refund_id = $2, status = $3, attempts = attempts + 1, last_error = NULL, updated_at = NOW()
         WHERE id = $1`,
        [refund.id, accepted.id, status]
      );
      if (status === "processed") {
        await markPaymentRefunded(client, refund.id);
      }
      logger.info({ refundId: refund.id, providerRefundId: accepted.id, status, adopted: Boolean(existing) }, "Refund sent to Razorpay");
    } catch (err) {
      // Keep it pending; the job retries. (Recorded in this same transaction, which commits.)
      await client.query(
        "UPDATE refunds SET attempts = attempts + 1, last_error = $2, updated_at = NOW() WHERE id = $1",
        [refund.id, err instanceof Error ? err.message : String(err)]
      );
      const level = refund.attempts + 1 >= MAX_ATTEMPTS ? "error" : "warn";
      logger[level]({ err, refundId: refund.id, attempt: refund.attempts + 1 }, "Refund call to Razorpay failed; will retry");
    }
  });
};

// For the background job: send refunds that Razorpay hasn't accepted yet
export const retryPendingRefunds = async ({ maxRefunds = 20 }: { maxRefunds?: number } = {}): Promise<number> => {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM refunds
     WHERE status = 'pending' AND provider_refund_id IS NULL AND attempts < $1
     ORDER BY created_at
     LIMIT $2`,
    [MAX_ATTEMPTS, maxRefunds]
  );
  for (const { id } of rows) {
    await processRefund(id);
  }
  return rows.length;
};

// Webhooks: refund.processed / refund.failed (and refund.created) from Razorpay.
// Runs inside the webhook's transaction.
export const recordRefundEvent = async (client: TransactionClient, eventType: string, entity: RefundWebhookEntity): Promise<void> => {
  if (!entity?.id) {
    return;
  }

  // Normally we stored Razorpay's id when it accepted the refund. If that answer was lost,
  // match the event to our still-unsent refund for the same payment instead.
  const { rows: [refund] } = await client.query<{ id: string }>(
    `SELECT r.id FROM refunds r
     WHERE r.provider_refund_id = $1
        OR (r.provider_refund_id IS NULL AND r.status = 'pending'
            AND r.payment_id = (SELECT id FROM payments WHERE provider_payment_id = $2))
     ORDER BY (r.provider_refund_id = $1) DESC NULLS LAST
     LIMIT 1
     FOR UPDATE`,
    [entity.id, entity.payment_id]
  );
  if (!refund) {
    return;   // a refund made by hand in Razorpay's dashboard, not by us
  }

  // Webhooks can arrive out of order (e.g. "created" after "processed"), so a status only
  // ever moves forward: pending → processed / failed. "refund.created" just records the id.
  const status: RefundStatus | null = eventType === "refund.processed" ? "processed" : eventType === "refund.failed" ? "failed" : null;
  await client.query(
    `UPDATE refunds
     SET provider_refund_id = $2,
         status = CASE WHEN status = 'pending' AND $3::text IS NOT NULL THEN $3 ELSE status END,
         updated_at = NOW()
     WHERE id = $1`,
    [refund.id, entity.id, status]
  );

  if (status === "processed") {
    await markPaymentRefunded(client, refund.id);
    logger.info({ refundId: refund.id, providerRefundId: entity.id }, "Refund processed: the customer has their money back");
  }
  if (status === "failed") {
    logger.error({ refundId: refund.id, providerRefundId: entity.id }, "Razorpay could not complete a refund: needs a person to look at it");
  }
};
