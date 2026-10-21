-- Real product search: full-text search (words, with ranking) plus trigram matching (typos).

-- pg_trgm splits text into 3-letter pieces ("mug" → "  m", " mu", "mug", "ug ") and measures
-- how many two texts share, so "hedphones" still looks a lot like "headphones".
-- It's a "trusted" extension: the database's owner can enable it without being a superuser.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The searchable form of a product, kept up to date by PostgreSQL itself (a generated column).
-- to_tsvector('english', ...) splits the text into words, drops filler words ("the", "and")
-- and reduces each word to its root ("running" → "run", "lamps" → "lamp").
-- setweight marks where a word came from: A = name, B = description, so a match in the
-- name ranks higher than one in the description.
ALTER TABLE products ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', name), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B')
) STORED;

-- GIN = an "inverted" index: for every word, the list of rows containing it (like the index
-- at the back of a book). Without these, every search would read every product.
CREATE INDEX products_search_vector_idx ON products USING GIN (search_vector);

-- The same idea for 3-letter pieces of the name: speeds up typo matching (<%) and ILIKE '%...%'
CREATE INDEX products_name_trgm_idx ON products USING GIN (name gin_trgm_ops);
