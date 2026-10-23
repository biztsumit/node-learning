-- Payment reconciliation: asking Razorpay directly whether a payment went through.
--
-- Normally we learn a payment succeeded from the customer's browser (verify) or Razorpay's
-- webhook. If both are lost (the tab closed, the server restarted, no webhook configured),
-- the order would wait unpaid although the customer paid. The maintenance job now asks
-- Razorpay about payment requests that are still "created"; checked_at stops it asking about
-- the same one every minute.
ALTER TABLE payments ADD COLUMN checked_at TIMESTAMPTZ;

-- "Unconfirmed payment requests, least recently checked first"
CREATE INDEX payments_unconfirmed_idx ON payments (checked_at NULLS FIRST, created_at) WHERE status = 'created';
