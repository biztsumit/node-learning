-- Wishlist: products a customer saved for later. One row per (customer, product).
CREATE TABLE wishlist_items (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A composite primary key: the pair is unique, so saving twice can't make two rows
  PRIMARY KEY (user_id, product_id)
);

-- Stock ledger: every change to a variant's stock, with how much, why, and who/what caused it.
-- Like a bank statement: the balance (stock) is the sum of all movements, so any number
-- can be explained ("why do we have 3 left?") and mistakes can be traced.
CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT app_uuid(),
  -- SET NULL: deleting a variant or product keeps its history
  variant_id UUID REFERENCES product_variants (id) ON DELETE SET NULL,
  product_id UUID REFERENCES products (id) ON DELETE SET NULL,
  change INTEGER NOT NULL CHECK (change <> 0),   -- +10 received, -2 sold
  stock_after INTEGER NOT NULL,                  -- the balance right after this movement
  reason VARCHAR(30) NOT NULL CHECK (reason IN (
    'initial',          -- the variant was created with this stock
    'restock',          -- new stock arrived
    'damaged',          -- written off: broken, lost, expired
    'returned',         -- a customer sent it back
    'correction',       -- a stock count found a different number
    'order_placed',     -- checkout took it
    'order_cancelled',  -- a cancelled order put it back
    'manual'            -- changed outside the app (SQL by hand): no reason was given
  )),
  order_id UUID REFERENCES orders (id) ON DELETE SET NULL,
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,   -- who did it (admin or customer)
  note VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX stock_movements_variant_idx ON stock_movements (variant_id, created_at);
CREATE INDEX stock_movements_product_idx ON stock_movements (product_id, created_at);
CREATE INDEX stock_movements_order_idx ON stock_movements (order_id) WHERE order_id IS NOT NULL;

-- The ledger is written by the DATABASE, not by each piece of code that changes stock.
-- Checkout, cancel, admin edits, even someone running UPDATE by hand: all recorded, nothing forgotten.
--
-- The app passes the "why" and "who" through settings that last only until the end of the
-- current transaction (set_config(..., true)): app.stock_reason, app.order_id, app.user_id,
-- app.stock_note. Without them, the movement is recorded as 'manual'.
CREATE FUNCTION record_stock_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  delta INTEGER;
  why TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    delta := NEW.stock;
    why := 'initial';
  ELSE
    delta := NEW.stock - OLD.stock;
    -- current_setting(name, true): NULL instead of an error when it was never set;
    -- NULLIF(..., ''): a setting from an earlier transaction comes back as '' (cleared)
    why := COALESCE(NULLIF(current_setting('app.stock_reason', true), ''), 'manual');
  END IF;

  IF delta = 0 THEN
    RETURN NULL;   -- price changed, or stock set to the same number: nothing moved
  END IF;

  -- clock_timestamp(), not NOW(): NOW() is when the transaction STARTED. A checkout that waited
  -- for a lock would be stamped before a change it actually came after.
  INSERT INTO stock_movements (variant_id, product_id, change, stock_after, reason, order_id, user_id, note, created_at)
  VALUES (
    NEW.id, NEW.product_id, delta, NEW.stock, why,
    NULLIF(current_setting('app.order_id', true), '')::uuid,
    NULLIF(current_setting('app.user_id', true), '')::uuid,
    NULLIF(current_setting('app.stock_note', true), ''),
    clock_timestamp()
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER product_variants_record_stock_movement
  AFTER INSERT OR UPDATE OF stock ON product_variants
  FOR EACH ROW EXECUTE FUNCTION record_stock_movement();

-- Opening balances: today's stock becomes each variant's first movement,
-- so "stock = sum of movements" holds from the start
INSERT INTO stock_movements (variant_id, product_id, change, stock_after, reason, note)
SELECT id, product_id, stock, stock, 'initial', 'Opening balance when the ledger started'
FROM product_variants
WHERE stock > 0;
