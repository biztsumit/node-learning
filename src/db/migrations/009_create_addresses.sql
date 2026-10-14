CREATE TABLE addresses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label VARCHAR(50),                       -- e.g. "Home", "Office" (optional)
  full_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  line1 VARCHAR(255) NOT NULL,
  line2 VARCHAR(255),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  postal_code VARCHAR(20) NOT NULL,
  country CHAR(2) NOT NULL DEFAULT 'IN',   -- ISO country code
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX addresses_user_id_idx ON addresses (user_id);

-- A "partial" unique index: it only covers rows WHERE is_default is true,
-- so each user can have many addresses but at most ONE default.
CREATE UNIQUE INDEX addresses_one_default_per_user_idx ON addresses (user_id) WHERE is_default;

-- Each order keeps a copy (snapshot) of the address it was shipped to.
-- NULL for orders placed before addresses existed.
ALTER TABLE orders ADD COLUMN shipping_address JSONB;
