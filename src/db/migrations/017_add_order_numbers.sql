-- Short order numbers people can read out on a support call, e.g. "ORD-7K3M9Q".
-- Random (not counting), so they don't reveal how many orders the shop gets.
ALTER TABLE orders ADD COLUMN order_number VARCHAR(12);

-- Give every existing order one. Same alphabet as the app: no 0/O, 1/I/L or U,
-- so nobody has to ask "was that a zero or an O?".
DO $$
DECLARE
  alphabet CONSTANT TEXT := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  existing RECORD;
  candidate TEXT;
BEGIN
  FOR existing IN SELECT id FROM orders ORDER BY created_at LOOP
    LOOP
      candidate := 'ORD-' || (
        SELECT string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '')
        FROM generate_series(1, 6)
      );
      EXIT WHEN NOT EXISTS (SELECT 1 FROM orders WHERE order_number = candidate);
    END LOOP;
    UPDATE orders SET order_number = candidate WHERE id = existing.id;
  END LOOP;
END;
$$;

ALTER TABLE orders
ALTER COLUMN order_number SET NOT NULL,
ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);
