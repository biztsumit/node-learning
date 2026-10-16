-- Why an order was cancelled (NULL while it isn't, and for orders cancelled before this existed)
ALTER TABLE orders
ADD COLUMN cancel_reason VARCHAR(30)
  CHECK (cancel_reason IN ('customer', 'admin', 'payment_timeout'));

-- The expiry job asks "which pending orders are older than 30 minutes?" every minute.
-- This partial index only contains PENDING orders, sorted by age, so that question stays
-- fast even with millions of old paid/shipped orders in the table.
CREATE INDEX orders_pending_created_at_idx ON orders (created_at) WHERE status = 'pending';
