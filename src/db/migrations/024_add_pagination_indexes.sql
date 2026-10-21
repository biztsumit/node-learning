-- Indexes in the same column order as the lists' sorts. With them, both "first page" and
-- "the page after this cursor" are a jump to one spot in the index plus reading `limit` rows,
-- however long the list gets. (A B-tree index can be read in either direction, so one
-- index serves both ASC and DESC sorts.)

-- GET /orders (one customer's orders, newest first) and GET /admin/orders (everyone's)
CREATE INDEX orders_user_created_idx ON orders (user_id, created_at, id);
CREATE INDEX orders_created_idx ON orders (created_at, id);

-- GET /admin/stock-movements (the ledger only ever grows)
CREATE INDEX stock_movements_created_idx ON stock_movements (created_at, id);

-- GET /products: the default sort (newest) and the price sorts
CREATE INDEX products_created_idx ON products (created_at, id);
CREATE INDEX products_price_idx ON products (price, id);
