-- A payment can now end up refunded
ALTER TABLE payments
DROP CONSTRAINT payments_status_check,
ADD CONSTRAINT payments_status_check CHECK (status IN ('created', 'paid', 'failed', 'refunded'));

-- One row per refund we ask Razorpay for
CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT app_uuid(),
  payment_id uuid NOT NULL REFERENCES payments (id) ON DELETE RESTRICT,
  -- Razorpay's id ("rfnd_..."), known once Razorpay has accepted the refund
  provider_refund_id VARCHAR(100) UNIQUE,
  amount INTEGER NOT NULL CHECK (amount > 0),          -- paise, like payments.amount
  reason VARCHAR(40) NOT NULL
    CHECK (reason IN ('order_cancelled', 'paid_after_cancellation')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,                 -- calls to Razorpay so far
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most ONE refund in progress or done per payment. Two things noticing "this needs a
-- refund" at the same moment (a webhook and the browser, say) can't both create one.
-- A failed refund doesn't count, so it can be tried again.
CREATE UNIQUE INDEX refunds_one_active_per_payment_idx ON refunds (payment_id) WHERE status <> 'failed';

-- For the retry job: refunds Razorpay hasn't accepted yet
CREATE INDEX refunds_unsent_idx ON refunds (created_at) WHERE provider_refund_id IS NULL AND status = 'pending';
