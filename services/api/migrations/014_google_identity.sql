-- Existing passwords and accounts are preserved. Google-only accounts explicitly
-- disable password authentication rather than inventing a password for the user.
CREATE TABLE IF NOT EXISTS account_password_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
) STRICT;
CREATE TABLE IF NOT EXISTS account_identities (
  provider TEXT NOT NULL CHECK (provider = 'google'),
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject),
  UNIQUE (user_id, provider)
) STRICT;
CREATE TABLE IF NOT EXISTS google_auth_attempts (
  state_hash TEXT PRIMARY KEY,
  binding_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('web', 'native')),
  intent TEXT NOT NULL CHECK (intent IN ('login', 'link')),
  origin TEXT,
  actor_id TEXT REFERENCES users(id),
  session_hash TEXT,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS google_auth_expiry ON google_auth_attempts(expires_at);
