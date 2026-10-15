-- Every login token carries the user's token_version at the time it was issued.
-- Raising this number (on password change or "log out everywhere") makes all older tokens invalid.
ALTER TABLE users
ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0,
ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
