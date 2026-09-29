-- Staff authority is separate from rider/driver capability membership.
CREATE TABLE staff_memberships (
  user_id TEXT PRIMARY KEY REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
  role TEXT NOT NULL CHECK(role IN ('owner','operations','support','safety','finance')),
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  version BIGINT NOT NULL CHECK(version > 0),
  updated_at BIGINT NOT NULL
);
INSERT INTO staff_memberships(user_id,role,status,version,updated_at)
 SELECT id,'owner','active',1,created_at FROM users WHERE role='admin';
CREATE INDEX staff_active_roles ON staff_memberships(status,role,user_id);
CREATE TABLE staff_commands (
  actor_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED, key TEXT NOT NULL, fingerprint TEXT NOT NULL,
  PRIMARY KEY(actor_id,key)
);
CREATE TABLE staff_access_audit (
  id BIGSERIAL PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED, action TEXT NOT NULL,
  subject_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED, detail TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE INDEX staff_access_audit_recent ON staff_access_audit(created_at,id);
CREATE TABLE staff_mfa (
  user_id TEXT PRIMARY KEY REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED, secret_encrypted TEXT NOT NULL,
  enabled_at BIGINT NOT NULL, last_counter BIGINT NOT NULL, version BIGINT NOT NULL DEFAULT 1
);
CREATE TABLE staff_mfa_pending (
  user_id TEXT PRIMARY KEY REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED, session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  secret_encrypted TEXT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE TABLE staff_stepups (
  session_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  user_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED, verified_until BIGINT NOT NULL,
  factor_version BIGINT NOT NULL, membership_version BIGINT NOT NULL
);
CREATE INDEX staff_stepups_user ON staff_stepups(user_id);
