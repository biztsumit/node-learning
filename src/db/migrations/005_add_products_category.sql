-- Each product can belong to one category.
-- NULL is allowed so existing products (which have no category yet) stay valid.
ALTER TABLE products
ADD COLUMN category_id INTEGER REFERENCES categories (id) ON DELETE RESTRICT;

-- Makes "find all products in category X" fast
CREATE INDEX products_category_id_idx ON products (category_id);
