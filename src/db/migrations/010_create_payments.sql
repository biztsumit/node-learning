-- One row per payment attempt for an order
CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  provider VARCHAR(20) NOT NULL DEFAULT 'razorpay',
  -- Razorpay's id for the payment request we created, e.g. "order_Nx8...". Unique per attempt.
  provider_order_id VARCHAR(100) NOT NULL UNIQUE,
  -- Razorpay's id for the actual payment, e.g. "pay_Nx9...". Known once the customer pays.
  provider_payment_id VARCHAR(100) UNIQUE,
  -- In the smallest unit of the currency (paise for INR): ₹799 is stored as 79900
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status VARCHAR(20) NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'paid', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX payments_order_id_idx ON payments (order_id);

-- Every webhook event we've processed. Razorpay may send the same event more than once;
-- the PRIMARY KEY makes sure we only ever act on it once.
CREATE TABLE webhook_events (
  event_id VARCHAR(100) PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
