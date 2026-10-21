-- Product variants: the things you actually buy, e.g. "T-Shirt, size M, blue".
-- Every product has at least one. A simple product has one "default" variant with no options.
CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT app_uuid(),
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  -- e.g. {"size": "M", "colour": "Blue"}; {} for a product without options
  options JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(options) = 'object'),
  sku VARCHAR(64) UNIQUE,                         -- optional stock-keeping code, e.g. "TEE-M-BLU"
  price INTEGER NOT NULL CHECK (price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- the same combination of options can't exist twice for one product
  CONSTRAINT product_variants_product_options_key UNIQUE (product_id, options)
);

-- products.price / products.stock become a SUMMARY of the variants: the lowest price
-- ("from ₹799") and the total stock. The database keeps them up to date, so product lists,
-- filters and sorting keep working without change. Don't write them directly.
CREATE FUNCTION refresh_product_summary() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  affected uuid := COALESCE(NEW.product_id, OLD.product_id);
BEGIN
  UPDATE products p
  SET price = COALESCE((SELECT MIN(v.price) FROM product_variants v WHERE v.product_id = affected), p.price),
      stock = COALESCE((SELECT SUM(v.stock) FROM product_variants v WHERE v.product_id = affected), 0)
  WHERE p.id = affected;
  RETURN NULL;
END;
$$;

CREATE TRIGGER product_variants_refresh_summary
  AFTER INSERT OR DELETE OR UPDATE OF price, stock ON product_variants
  FOR EACH ROW EXECUTE FUNCTION refresh_product_summary();

-- Any variant change also clears the catalog cache (migration 019's notification)
CREATE TRIGGER product_variants_notify_catalog_changed
  AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON product_variants
  FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_changed();

-- Existing products: one default variant each, with their current price and stock
INSERT INTO product_variants (product_id, price, stock)
SELECT id, price, stock FROM products;

-- ---------- Cart lines point at a variant ----------
ALTER TABLE cart_items ADD COLUMN variant_id uuid REFERENCES product_variants (id) ON DELETE CASCADE;
UPDATE cart_items ci SET variant_id = v.id FROM product_variants v WHERE v.product_id = ci.product_id;
ALTER TABLE cart_items ALTER COLUMN variant_id SET NOT NULL;
-- One line per VARIANT now: a cart can hold both "size S" and "size M" of the same product
ALTER TABLE cart_items DROP CONSTRAINT cart_items_user_product_key;
ALTER TABLE cart_items ADD CONSTRAINT cart_items_user_variant_key UNIQUE (user_id, variant_id);
CREATE INDEX cart_items_variant_id_idx ON cart_items (variant_id);

-- ---------- Order lines remember which variant was bought ----------
-- SET NULL like product_id: the order keeps its snapshot if the variant is deleted later
ALTER TABLE order_items
ADD COLUMN variant_id uuid REFERENCES product_variants (id) ON DELETE SET NULL,
ADD COLUMN variant_options JSONB NOT NULL DEFAULT '{}',
ADD COLUMN sku VARCHAR(64);
UPDATE order_items oi SET variant_id = v.id FROM product_variants v WHERE v.product_id = oi.product_id;
CREATE INDEX order_items_variant_id_idx ON order_items (variant_id);
