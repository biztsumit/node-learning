-- Refresh tokens (long logins without long-lived access tokens) and two-factor login.

-- One row per refresh token ever issued. A "session" is a FAMILY of them: each refresh
-- replaces the token with a new one in the same family (rotation). Only a hash is stored,
-- like passwords: a leaked database doesn't hand out working logins.
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT app_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id UUID NOT NULL,                     -- all the tokens of one login session
  token_hash VARCHAR(64) NOT NULL UNIQUE,      -- sha256 of the token, as hex
  mfa BOOLEAN NOT NULL DEFAULT false,          -- this session passed two-factor login
  user_agent VARCHAR(255),                     -- "which device is this?" (for a sessions list)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,                         -- exchanged for a new token (rotated)
  revoked_at TIMESTAMPTZ                       -- logged out, or the family was revoked
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- Two-factor login (TOTP: the 6-digit codes from an authenticator app)
ALTER TABLE users
  -- The shared secret, ENCRYPTED (the app needs it back to check codes, so it can't be hashed)
  ADD COLUMN totp_secret TEXT,
  -- NULL = not turned on (a secret may exist while the user is still setting it up)
  ADD COLUMN totp_enabled_at TIMESTAMPTZ,
  -- The 30-second time step of the last accepted code: the same code can't be used twice
  ADD COLUMN totp_last_step BIGINT;

-- One-time recovery codes, for when the phone is lost. Hashed, like passwords.
CREATE TABLE recovery_codes (
  id UUID PRIMARY KEY DEFAULT app_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash VARCHAR(64) NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX recovery_codes_user_idx ON recovery_codes (user_id) WHERE used_at IS NULL;

-- The audit log must never contain the 2FA secret, and the "last used step" is noise.
-- (Turning 2FA on or off still shows up, as a change of totp_enabled_at.)
DROP TRIGGER users_audit ON users;
CREATE TRIGGER users_audit AFTER UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_changes(
    'ignore:updated_at', 'ignore:token_version', 'ignore:totp_last_step',
    'redact:password_hash', 'redact:totp_secret');
