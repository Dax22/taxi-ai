CREATE TABLE vehicle_photo_checks (
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL REFERENCES rides(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  command_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  expected_json TEXT NOT NULL,
  result_json TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending','complete','unavailable','trip_ended')),
  model TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  expires_at INTEGER NOT NULL,
  UNIQUE(owner_id,command_key)
);
CREATE INDEX vehicle_checks_ride ON vehicle_photo_checks(owner_id,ride_id,created_at);
CREATE INDEX vehicle_checks_expiry ON vehicle_photo_checks(expires_at);
CREATE INDEX vehicle_checks_rate ON vehicle_photo_checks(created_at,state);
