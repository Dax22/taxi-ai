-- Add one durable, non-token welcome email intention without rewriting existing jobs.
PRAGMA foreign_keys=OFF;
CREATE TABLE account_email_jobs_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset', 'changed', 'welcome')),
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, purpose)
) STRICT;
INSERT INTO account_email_jobs_next SELECT * FROM account_email_jobs;
DROP TABLE account_email_jobs;
ALTER TABLE account_email_jobs_next RENAME TO account_email_jobs;
CREATE INDEX account_email_job_schedule ON account_email_jobs(next_attempt_at, lease_until);
PRAGMA foreign_keys=ON;
