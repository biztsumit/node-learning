-- Switch every id from a counting integer (1, 2, 3, ...) to a UUID, KEEPING all existing data.
-- The migration runner wraps this file in one transaction: it either fully works or changes nothing.
--
-- The plan, for every table:
--   1. give each row a new UUID next to its old integer id
--   2. give each child row its parent's NEW id, found through the OLD id
--   3. drop the old integer columns (this also drops their keys and indexes)
--   4. rename the new columns to the old names
--   5. recreate every primary key, foreign key, unique key and index, with the same names and rules

-- ---------- 0. How new ids are made ----------
-- UUIDv7 (time-ordered, built into PostgreSQL 18+); random UUIDv4 on older servers.
-- Every table uses this as its id default from now on.
CREATE FUNCTION app_uuid() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF current_setting('server_version_num')::int >= 180000 THEN
    RETURN uuidv7();
  END IF;
  RETURN gen_random_uuid();
END;
$$;

-- ---------- 1. A new UUID for every row ----------
ALTER TABLE users       ADD COLUMN new_id uuid NOT NULL DEFAULT app_uuid();
ALTER TABLE categories  ADD COLUMN new_id uuid NOT NULL DEFAULT app_uuid();
ALTER TABLE products    ADD COLUMN new_id uuid NOT NULL DEFAULT app_uuid();
ALTER TABLE cart_items  ADD COLUMN new_id uuid NOT NULL DEFAULT app_uuid();
ALTER TABLE orders      ADD COLUMN new_id uuid NOT NULL DEFAULT app_uuid();
ALTER TABLE order_items ADD COLUMN new_id uuid NOT NULL DEFAULT app_uuid();
ALTER TABLE addresses   ADD COLUMN new_id uuid NOT NULL DEFAULT app_uuid();
ALTER TABLE payments    ADD COLUMN new_id uuid NOT NULL DEFAULT app_uuid();
ALTER TABLE reviews     ADD COLUMN new_id uuid NOT NULL DEFAULT app_uuid();

-- ---------- 2. Point every child row at its parent's new UUID ----------
ALTER TABLE products ADD COLUMN new_category_id uuid;
UPDATE products p SET new_category_id = c.new_id FROM categories c WHERE c.id = p.category_id;

ALTER TABLE cart_items ADD COLUMN new_user_id uuid, ADD COLUMN new_product_id uuid;
UPDATE cart_items ci SET new_user_id = u.new_id FROM users u WHERE u.id = ci.user_id;
UPDATE cart_items ci SET new_product_id = p.new_id FROM products p WHERE p.id = ci.product_id;

ALTER TABLE orders ADD COLUMN new_user_id uuid;
UPDATE orders o SET new_user_id = u.new_id FROM users u WHERE u.id = o.user_id;

ALTER TABLE order_items ADD COLUMN new_order_id uuid, ADD COLUMN new_product_id uuid;
UPDATE order_items oi SET new_order_id = o.new_id FROM orders o WHERE o.id = oi.order_id;
UPDATE order_items oi SET new_product_id = p.new_id FROM products p WHERE p.id = oi.product_id;

ALTER TABLE addresses ADD COLUMN new_user_id uuid;
UPDATE addresses a SET new_user_id = u.new_id FROM users u WHERE u.id = a.user_id;

ALTER TABLE payments ADD COLUMN new_order_id uuid;
UPDATE payments pm SET new_order_id = o.new_id FROM orders o WHERE o.id = pm.order_id;

ALTER TABLE reviews ADD COLUMN new_product_id uuid, ADD COLUMN new_user_id uuid;
UPDATE reviews r SET new_product_id = p.new_id FROM products p WHERE p.id = r.product_id;
UPDATE reviews r SET new_user_id = u.new_id FROM users u WHERE u.id = r.user_id;

-- ---------- 3. Drop the old integer columns ----------
-- Foreign-key columns first: dropping them also drops their foreign keys and indexes.
-- No CASCADE on purpose: if anything unexpected depends on a column, this fails loudly instead.
ALTER TABLE products    DROP COLUMN category_id;
ALTER TABLE cart_items  DROP COLUMN user_id, DROP COLUMN product_id;
ALTER TABLE orders      DROP COLUMN user_id;
ALTER TABLE order_items DROP COLUMN order_id, DROP COLUMN product_id;
ALTER TABLE addresses   DROP COLUMN user_id;
ALTER TABLE payments    DROP COLUMN order_id;
ALTER TABLE reviews     DROP COLUMN product_id, DROP COLUMN user_id;

-- Then the old ids (this also drops the old primary keys and their SERIAL counters)
ALTER TABLE users       DROP COLUMN id;
ALTER TABLE categories  DROP COLUMN id;
ALTER TABLE products    DROP COLUMN id;
ALTER TABLE cart_items  DROP COLUMN id;
ALTER TABLE orders      DROP COLUMN id;
ALTER TABLE order_items DROP COLUMN id;
ALTER TABLE addresses   DROP COLUMN id;
ALTER TABLE payments    DROP COLUMN id;
ALTER TABLE reviews     DROP COLUMN id;

-- ---------- 4. Give the new columns the old names ----------
ALTER TABLE users       RENAME COLUMN new_id TO id;
ALTER TABLE categories  RENAME COLUMN new_id TO id;
ALTER TABLE products    RENAME COLUMN new_id TO id;
ALTER TABLE products    RENAME COLUMN new_category_id TO category_id;
ALTER TABLE cart_items  RENAME COLUMN new_id TO id;
ALTER TABLE cart_items  RENAME COLUMN new_user_id TO user_id;
ALTER TABLE cart_items  RENAME COLUMN new_product_id TO product_id;
ALTER TABLE orders      RENAME COLUMN new_id TO id;
ALTER TABLE orders      RENAME COLUMN new_user_id TO user_id;
ALTER TABLE order_items RENAME COLUMN new_id TO id;
ALTER TABLE order_items RENAME COLUMN new_order_id TO order_id;
ALTER TABLE order_items RENAME COLUMN new_product_id TO product_id;
ALTER TABLE addresses   RENAME COLUMN new_id TO id;
ALTER TABLE addresses   RENAME COLUMN new_user_id TO user_id;
ALTER TABLE payments    RENAME COLUMN new_id TO id;
ALTER TABLE payments    RENAME COLUMN new_order_id TO order_id;
ALTER TABLE reviews     RENAME COLUMN new_id TO id;
ALTER TABLE reviews     RENAME COLUMN new_product_id TO product_id;
ALTER TABLE reviews     RENAME COLUMN new_user_id TO user_id;

-- ---------- 5. Recreate every key and index (same names, same rules as before) ----------
ALTER TABLE users       ADD CONSTRAINT users_pkey       PRIMARY KEY (id);
ALTER TABLE categories  ADD CONSTRAINT categories_pkey  PRIMARY KEY (id);
ALTER TABLE products    ADD CONSTRAINT products_pkey    PRIMARY KEY (id);
ALTER TABLE cart_items  ADD CONSTRAINT cart_items_pkey  PRIMARY KEY (id);
ALTER TABLE orders      ADD CONSTRAINT orders_pkey      PRIMARY KEY (id);
ALTER TABLE order_items ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);
ALTER TABLE addresses   ADD CONSTRAINT addresses_pkey   PRIMARY KEY (id);
ALTER TABLE payments    ADD CONSTRAINT payments_pkey    PRIMARY KEY (id);
ALTER TABLE reviews     ADD CONSTRAINT reviews_pkey     PRIMARY KEY (id);

-- Required links (a NULL here would mean a row lost its parent: the whole migration would roll back)
ALTER TABLE cart_items  ALTER COLUMN user_id SET NOT NULL, ALTER COLUMN product_id SET NOT NULL;
ALTER TABLE orders      ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE order_items ALTER COLUMN order_id SET NOT NULL;
ALTER TABLE addresses   ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE payments    ALTER COLUMN order_id SET NOT NULL;
ALTER TABLE reviews     ALTER COLUMN product_id SET NOT NULL, ALTER COLUMN user_id SET NOT NULL;
-- (products.category_id and order_items.product_id stay optional, as before)

ALTER TABLE products    ADD CONSTRAINT products_category_id_fkey   FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT;
ALTER TABLE cart_items  ADD CONSTRAINT cart_items_user_id_fkey     FOREIGN KEY (user_id)     REFERENCES users (id)      ON DELETE CASCADE;
ALTER TABLE cart_items  ADD CONSTRAINT cart_items_product_id_fkey  FOREIGN KEY (product_id)  REFERENCES products (id)   ON DELETE CASCADE;
ALTER TABLE orders      ADD CONSTRAINT orders_user_id_fkey         FOREIGN KEY (user_id)     REFERENCES users (id)      ON DELETE RESTRICT;
ALTER TABLE order_items ADD CONSTRAINT order_items_order_id_fkey   FOREIGN KEY (order_id)    REFERENCES orders (id)     ON DELETE CASCADE;
ALTER TABLE order_items ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id)  REFERENCES products (id)   ON DELETE SET NULL;
ALTER TABLE addresses   ADD CONSTRAINT addresses_user_id_fkey      FOREIGN KEY (user_id)     REFERENCES users (id)      ON DELETE CASCADE;
ALTER TABLE payments    ADD CONSTRAINT payments_order_id_fkey      FOREIGN KEY (order_id)    REFERENCES orders (id)     ON DELETE RESTRICT;
ALTER TABLE reviews     ADD CONSTRAINT reviews_product_id_fkey     FOREIGN KEY (product_id)  REFERENCES products (id)   ON DELETE CASCADE;
ALTER TABLE reviews     ADD CONSTRAINT reviews_user_id_fkey        FOREIGN KEY (user_id)     REFERENCES users (id)      ON DELETE CASCADE;

ALTER TABLE cart_items ADD CONSTRAINT cart_items_user_product_key UNIQUE (user_id, product_id);
ALTER TABLE reviews    ADD CONSTRAINT reviews_product_user_key    UNIQUE (product_id, user_id);

CREATE INDEX products_category_id_idx    ON products (category_id);
CREATE INDEX cart_items_product_id_idx   ON cart_items (product_id);
CREATE INDEX orders_user_id_idx          ON orders (user_id);
CREATE INDEX order_items_order_id_idx    ON order_items (order_id);
CREATE INDEX order_items_product_id_idx  ON order_items (product_id);
CREATE INDEX addresses_user_id_idx       ON addresses (user_id);
CREATE INDEX payments_order_id_idx       ON payments (order_id);
CREATE UNIQUE INDEX addresses_one_default_per_user_idx ON addresses (user_id) WHERE is_default;
