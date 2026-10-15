CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One review per customer per product (also makes "reviews of product X" fast)
  CONSTRAINT reviews_product_user_key UNIQUE (product_id, user_id)
);

-- A stored copy of each product's rating summary, so product lists don't have to
-- calculate AVG/COUNT over all reviews on every request. Kept up to date by the app
-- in the same transaction as every review change.
ALTER TABLE products
ADD COLUMN rating_avg NUMERIC(3, 2) NOT NULL DEFAULT 0,
ADD COLUMN rating_count INTEGER NOT NULL DEFAULT 0;
