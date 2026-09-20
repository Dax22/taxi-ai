-- Add capabilities without rewriting identities, credentials, approvals or history.
-- A driver capability grants application access; it never grants driving approval.
CREATE TABLE account_capabilities (
  user_id TEXT NOT NULL REFERENCES users(id),
  capability TEXT NOT NULL CHECK (capability IN ('customer', 'driver')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, capability)
);

INSERT INTO account_capabilities (user_id, capability, created_at)
SELECT id, 'customer', created_at FROM users WHERE role IN ('customer', 'driver');
INSERT INTO account_capabilities (user_id, capability, created_at)
SELECT id, 'driver', created_at FROM users WHERE role = 'driver';

CREATE TABLE account_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  PRIMARY KEY (actor_id, key)
);
