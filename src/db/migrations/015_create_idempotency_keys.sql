-- Remembers requests sent with an Idempotency-Key header, so a retry of the SAME request
-- gets the saved response back instead of doing the work (e.g. placing an order) twice.
CREATE TABLE idempotency_keys (
  -- Keys are per user: two customers can't collide, or read each other's responses
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key VARCHAR(255) NOT NULL,
  -- Which request this key was first used for (a key can't be reused for something else)
  method VARCHAR(10) NOT NULL,
  path VARCHAR(255) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed')),
  response_status SMALLINT,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, key)
);

-- For the clean-up that deletes keys older than 24 hours
CREATE INDEX idempotency_keys_created_at_idx ON idempotency_keys (created_at);
