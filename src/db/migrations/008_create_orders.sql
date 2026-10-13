CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  -- RESTRICT: orders are business records, so a user who has orders can't be deleted
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'shipped', 'delivered', 'cancelled')),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX orders_user_id_idx ON orders (user_id);

CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  -- CASCADE: an order's lines only exist as part of that order
  order_id INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  -- SET NULL: if the product is deleted later, the order keeps its snapshot below
  product_id INTEGER REFERENCES products (id) ON DELETE SET NULL,
  -- Snapshot of the product at the moment of purchase
  product_name VARCHAR(255) NOT NULL,
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total INTEGER NOT NULL CHECK (line_total >= 0)
);

CREATE INDEX order_items_order_id_idx ON order_items (order_id);
CREATE INDEX order_items_product_id_idx ON order_items (product_id);
