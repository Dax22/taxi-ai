-- Existing profiles remain unverified until their owner confirms the mailbox.
CREATE TABLE IF NOT EXISTS account_email_verifications (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  email TEXT NOT NULL,
  verified_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS account_email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  email TEXT NOT NULL,
  credential_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE(user_id, purpose)
) STRICT;
CREATE INDEX IF NOT EXISTS account_email_token_expiry ON account_email_tokens(expires_at);

-- Durable delivery intentions only: no links, plaintext tokens or passwords.
CREATE TABLE IF NOT EXISTS account_email_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset', 'changed')),
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, purpose)
) STRICT;
CREATE INDEX IF NOT EXISTS account_email_job_schedule ON account_email_jobs(next_attempt_at, lease_until);
