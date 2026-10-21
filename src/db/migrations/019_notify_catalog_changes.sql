-- Tell every running server "the catalog changed" whenever products, categories or reviews
-- change, however it happens: an admin edit, a checkout reducing stock, a new review, or
-- someone running SQL by hand. Servers LISTEN for this and clear their cached catalog.
--
-- NOTIFY is transactional: it's delivered only when the change COMMITS, and repeated
-- identical notifications in one transaction are merged into one.
CREATE FUNCTION notify_catalog_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('catalog_changed', TG_TABLE_NAME);
  RETURN NULL;
END;
$$;

-- FOR EACH STATEMENT: one notification per statement, not one per row
CREATE TRIGGER products_notify_catalog_changed
  AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON products
  FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_changed();

CREATE TRIGGER categories_notify_catalog_changed
  AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON categories
  FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_changed();

CREATE TRIGGER reviews_notify_catalog_changed
  AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON reviews
  FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_changed();
