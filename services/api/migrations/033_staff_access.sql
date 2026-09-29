-- Staff authority is separate from rider/driver capability membership.
CREATE TABLE staff_memberships (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('owner','operations','support','safety','finance')),
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  version INTEGER NOT NULL CHECK(version > 0),
  updated_at INTEGER NOT NULL
) STRICT;
INSERT INTO staff_memberships(user_id,role,status,version,updated_at)
 SELECT id,'owner','active',1,created_at FROM users WHERE role='admin';
CREATE INDEX staff_active_roles ON staff_memberships(status,role,user_id);
CREATE TABLE staff_commands (
  actor_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, fingerprint TEXT NOT NULL,
  PRIMARY KEY(actor_id,key)
) STRICT;
CREATE TABLE staff_access_audit (
  id INTEGER PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
  subject_id TEXT NOT NULL REFERENCES users(id), detail TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX staff_access_audit_recent ON staff_access_audit(created_at,id);
CREATE TABLE staff_mfa (
  user_id TEXT PRIMARY KEY REFERENCES users(id), secret_encrypted TEXT NOT NULL,
  enabled_at INTEGER NOT NULL, last_counter INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE staff_mfa_pending (
  user_id TEXT PRIMARY KEY REFERENCES users(id), session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
  secret_encrypted TEXT NOT NULL, expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE staff_stepups (
  session_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id), verified_until INTEGER NOT NULL,
  factor_version INTEGER NOT NULL, membership_version INTEGER NOT NULL
) STRICT;
CREATE INDEX staff_stepups_user ON staff_stepups(user_id);
