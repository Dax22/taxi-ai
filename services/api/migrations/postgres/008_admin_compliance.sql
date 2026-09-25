-- Internal staff follow-up tasks. These rows do not send notifications or alter approval.
CREATE TABLE admin_compliance_followups (
  driver_id TEXT PRIMARY KEY REFERENCES driver_applications(driver_id) DEFERRABLE INITIALLY DEFERRED,
  status TEXT NOT NULL CHECK(status IN ('open','done')),
  due_at BIGINT NOT NULL,
  note TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  application_version INTEGER NOT NULL CHECK(application_version>=0),
  actor_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT,
  CHECK((status='done' AND completed_at IS NOT NULL) OR (status='open' AND completed_at IS NULL))
);
CREATE INDEX admin_compliance_due ON admin_compliance_followups(status,due_at,driver_id);
CREATE TABLE admin_compliance_events (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES driver_applications(driver_id) DEFERRABLE INITIALLY DEFERRED,
  actor_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
  action TEXT NOT NULL CHECK(action IN ('follow-up','complete')),
  note TEXT NOT NULL,
  due_at BIGINT NOT NULL,
  version INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX admin_compliance_history ON admin_compliance_events(driver_id,created_at,id);
CREATE TABLE admin_compliance_commands (
  actor_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  driver_id TEXT NOT NULL REFERENCES driver_applications(driver_id) DEFERRABLE INITIALLY DEFERRED,
  created_at BIGINT NOT NULL,
  PRIMARY KEY(actor_id,key)
);
CREATE INDEX admin_compliance_documents ON driver_documents(driver_id,expires_on);
CREATE INDEX admin_compliance_applications ON driver_applications(status,driver_id);
