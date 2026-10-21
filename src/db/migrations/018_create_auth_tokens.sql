-- When the user proved they own their email address (NULL = not yet)
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;

-- One-time tokens sent by email: password resets and email verification.
-- Only a SHA-256 HASH of each token is stored. The real token exists only in the email,
-- so someone who reads this table (a leaked backup, say) still can't use any of them.
CREATE TABLE auth_tokens (
  id uuid PRIMARY KEY DEFAULT app_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('password_reset', 'email_verification')),
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,                       -- set when used (or replaced): single use
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX auth_tokens_user_id_idx ON auth_tokens (user_id);
