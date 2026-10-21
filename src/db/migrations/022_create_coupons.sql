-- Discount codes ("WELCOME10": 10% off; "FLAT200": ₹200 off), with the rules shops need.

CREATE TABLE coupons (
  id UUID PRIMARY KEY DEFAULT app_uuid(),
  -- Stored in capitals, so "welcome10" and "WELCOME10" are the same code
  code VARCHAR(30) NOT NULL UNIQUE CHECK (code = upper(code)),
  description VARCHAR(255) NOT NULL DEFAULT '',
  discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  -- percent: 1-100; fixed: whole rupees off
  discount_value INTEGER NOT NULL CHECK (discount_value > 0),
  -- The cart must be worth at least this much (rupees)
  min_order_amount INTEGER NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
  -- A cap for percent coupons: "20% off, up to ₹500"
  max_discount INTEGER CHECK (max_discount > 0),
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  -- How many orders in total may use it (NULL = no limit), and how many per customer
  usage_limit INTEGER CHECK (usage_limit > 0),
  per_user_limit INTEGER CHECK (per_user_limit > 0),
  -- Kept up to date by checkout/cancel, under a lock on this row.
  -- The CHECK is a last line of defence: even buggy code can't push it past the limit.
  times_used INTEGER NOT NULL DEFAULT 0 CHECK (times_used >= 0 AND (usage_limit IS NULL OR times_used <= usage_limit)),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (discount_type <> 'percent' OR discount_value <= 100),
  CHECK (starts_at IS NULL OR expires_at IS NULL OR starts_at < expires_at)
);

-- Every use of a coupon: which order, which customer, how much it saved.
-- A cancelled order gives its use back (released_at is set); the row stays as history.
CREATE TABLE coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT app_uuid(),
  -- RESTRICT: a coupon that has been used can't be deleted (switch it off instead)
  coupon_id UUID NOT NULL REFERENCES coupons (id) ON DELETE RESTRICT,
  order_id UUID NOT NULL UNIQUE REFERENCES orders (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  discount_amount INTEGER NOT NULL CHECK (discount_amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ
);

-- "How many times has this customer used this coupon?" (counting only uses still in effect)
CREATE INDEX coupon_redemptions_coupon_user_idx ON coupon_redemptions (coupon_id, user_id) WHERE released_at IS NULL;

-- The order keeps its own copy of the money: subtotal - discount = total (what is paid).
ALTER TABLE orders
  ADD COLUMN subtotal_amount INTEGER,
  ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  ADD COLUMN coupon_code VARCHAR(30);

UPDATE orders SET subtotal_amount = total_amount;

ALTER TABLE orders
  ALTER COLUMN subtotal_amount SET NOT NULL,
  ADD CONSTRAINT orders_amounts_add_up CHECK (total_amount = subtotal_amount - discount_amount);
