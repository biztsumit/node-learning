-- Audit log: who changed what, and when. For prices, order statuses, roles, coupons...
--
-- Written by triggers, like the stock ledger: every change is recorded however it happens
-- (API, background job, or SQL typed by hand). The app tells the database WHO is acting
-- through transaction-scoped settings (app.user_id, app.request_id, app.source).
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT app_uuid(),
  table_name VARCHAR(50) NOT NULL,
  record_id UUID NOT NULL,
  action VARCHAR(10) NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  -- update: only what changed, {"price": [999, 799]} (old, new)
  -- insert/delete: the whole row as it was created/removed
  changes JSONB NOT NULL,
  -- No foreign key: the log must outlive the people in it (and a FK would make every
  -- change wait on a lock of the admin's users row)
  actor_id UUID,
  request_id VARCHAR(100),
  source VARCHAR(50) NOT NULL,   -- 'api', 'job:maintenance', or 'database' (no app context: SQL by hand)
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX audit_log_record_idx ON audit_log (table_name, record_id, created_at);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, created_at) WHERE actor_id IS NOT NULL;
CREATE INDEX audit_log_created_idx ON audit_log (created_at, id);

-- Append-only: a log that can be edited proves nothing. Even the app can't change history.
CREATE FUNCTION audit_log_is_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER audit_log_no_changes
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

-- One trigger function for every audited table. Its arguments say how to treat some columns:
--   'ignore:col'  never logged (derived values, timestamps, things another log covers)
--   'redact:col'  logged as "[redacted]": we record THAT a password changed, never the hash
CREATE FUNCTION audit_changes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ignored TEXT[] := '{}';
  redacted TEXT[] := '{}';
  arg TEXT;
  old_row JSONB;
  new_row JSONB;
  diff JSONB;
BEGIN
  FOREACH arg IN ARRAY TG_ARGV LOOP
    IF arg LIKE 'ignore:%' THEN
      ignored := ignored || substr(arg, 8);
    ELSIF arg LIKE 'redact:%' THEN
      redacted := redacted || substr(arg, 8);
    END IF;
  END LOOP;

  -- to_jsonb(row) turns the whole row into {"column": value, ...}; "- ignored" drops keys
  IF TG_OP <> 'INSERT' THEN
    old_row := to_jsonb(OLD) - ignored;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_row := to_jsonb(NEW) - ignored;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Pair up old and new values by column name; keep the ones that differ
    SELECT jsonb_object_agg(
             o.key,
             CASE WHEN o.key = ANY (redacted) THEN '["[redacted]", "[redacted]"]'::jsonb
                  ELSE jsonb_build_array(o.value, n.value) END)
      INTO diff
      FROM jsonb_each(old_row) o
      JOIN jsonb_each(new_row) n USING (key)
     WHERE o.value IS DISTINCT FROM n.value;
    IF diff IS NULL THEN
      RETURN NULL;   -- only ignored columns changed (e.g. updated_at): nothing to log
    END IF;
  ELSE
    diff := COALESCE(new_row, old_row);
    SELECT diff || COALESCE(jsonb_object_agg(r, '"[redacted]"'::jsonb), '{}')
      INTO diff
      FROM unnest(redacted) r
     WHERE diff ? r;
  END IF;

  INSERT INTO audit_log (table_name, record_id, action, changes, actor_id, request_id, source)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    lower(TG_OP),
    diff,
    NULLIF(current_setting('app.user_id', true), '')::uuid,
    NULLIF(current_setting('app.request_id', true), ''),
    COALESCE(NULLIF(current_setting('app.source', true), ''), 'database')
  );
  RETURN NULL;
END;
$$;

-- What we audit. Ignored: values the database derives itself (product price/stock summary,
-- ratings, search text), stock (the stock ledger has it), and update timestamps.
CREATE TRIGGER products_audit AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION audit_changes(
    'ignore:price', 'ignore:stock', 'ignore:rating_avg', 'ignore:rating_count',
    'ignore:search_vector', 'ignore:updated_at', 'ignore:created_at');

CREATE TRIGGER product_variants_audit AFTER INSERT OR UPDATE OR DELETE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION audit_changes('ignore:stock', 'ignore:created_at');

CREATE TRIGGER categories_audit AFTER INSERT OR UPDATE OR DELETE ON categories
  FOR EACH ROW EXECUTE FUNCTION audit_changes('ignore:created_at');

CREATE TRIGGER coupons_audit AFTER INSERT OR UPDATE OR DELETE ON coupons
  FOR EACH ROW EXECUTE FUNCTION audit_changes('ignore:times_used', 'ignore:updated_at', 'ignore:created_at');

-- Orders: only changes (status, cancellation). Placing an order is already a record of itself.
CREATE TRIGGER orders_audit AFTER UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION audit_changes('ignore:updated_at');

-- Users: changes only (role, name, email...). Registering is its own record.
-- token_version changes on every "log out everywhere" (noise); the password hash is a secret.
CREATE TRIGGER users_audit AFTER UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_changes('ignore:updated_at', 'ignore:token_version', 'redact:password_hash');
