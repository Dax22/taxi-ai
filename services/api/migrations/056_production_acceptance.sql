CREATE TABLE IF NOT EXISTS production_acceptance_results (
  check_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('passed','failed','needs_retest')),
  evidence_ref TEXT NOT NULL,
  note TEXT NOT NULL,
  tester_id TEXT NOT NULL REFERENCES users(id),
  tested_at INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK(version>=1),
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS production_acceptance_results_status ON production_acceptance_results(status,updated_at,check_key);
CREATE TABLE IF NOT EXISTS production_acceptance_events (
  id TEXT PRIMARY KEY,
  check_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('passed','failed','needs_retest')),
  evidence_ref TEXT NOT NULL,
  note TEXT NOT NULL,
  tester_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK(version>=1)
) STRICT;
CREATE INDEX IF NOT EXISTS production_acceptance_events_check ON production_acceptance_events(check_key,created_at DESC,id);
CREATE INDEX IF NOT EXISTS production_acceptance_events_created ON production_acceptance_events(created_at DESC,id);
CREATE TABLE IF NOT EXISTS production_acceptance_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  command_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  check_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,command_key)
) STRICT;
