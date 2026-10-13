-- A user's cart is simply all of their rows in this table.
CREATE TABLE cart_items (
  id SERIAL PRIMARY KEY,
  -- Deleting a user (or a product) removes it from carts too
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Each product appears at most once per cart; adding it again raises the quantity
  CONSTRAINT cart_items_user_product_key UNIQUE (user_id, product_id)
);

-- The UNIQUE (user_id, product_id) above already makes "find this user's cart" fast.
-- This one makes "remove a deleted product from every cart" fast.
CREATE INDEX cart_items_product_id_idx ON cart_items (product_id);
