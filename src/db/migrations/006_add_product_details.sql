ALTER TABLE products
ADD COLUMN description TEXT NOT NULL DEFAULT '',
ADD COLUMN stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
ADD COLUMN image_url TEXT,
ADD COLUMN slug VARCHAR(255);

-- Give existing products a slug: "Blue T-Shirt" (id 7) -> "blue-t-shirt-7"
-- The id on the end guarantees no two old products get the same slug.
UPDATE products
SET slug = COALESCE(
  NULLIF(TRIM(BOTH '-' FROM LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g'))), ''),
  'product'
) || '-' || id;

-- Now that every row has one, make it required and unique
ALTER TABLE products
ALTER COLUMN slug SET NOT NULL,
ADD CONSTRAINT products_slug_key UNIQUE (slug);
