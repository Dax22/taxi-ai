CREATE TABLE safety_monitor_sessions (
  owner_id TEXT NOT NULL REFERENCES users(id), ride_id TEXT NOT NULL REFERENCES rides(id),
  binding TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  preferences_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL,
  PRIMARY KEY(owner_id,ride_id)
) STRICT;
CREATE TABLE safety_auto_alerts (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), ride_id TEXT NOT NULL REFERENCES rides(id),
  kind TEXT NOT NULL CHECK(kind IN ('impact','distress','manual')), signal_json TEXT NOT NULL,
  snapshot_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('countdown','queued','cancelled','expired','finished')),
  created_at INTEGER NOT NULL, due_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE UNIQUE INDEX safety_one_countdown ON safety_auto_alerts(owner_id,ride_id) WHERE status IN ('countdown','queued');
CREATE TABLE safety_delivery_jobs (
  id TEXT PRIMARY KEY, alert_id TEXT NOT NULL REFERENCES safety_auto_alerts(id), contact_id TEXT REFERENCES trusted_contacts(id),
  recipient_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','sending','accepted','failed','cancelled','unavailable')),
  attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0,
  provider_reference TEXT, UNIQUE(alert_id,contact_id)
) STRICT;
CREATE INDEX safety_delivery_due ON safety_delivery_jobs(status,next_at);
CREATE TABLE safety_risk_zones (
  id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES users(id), label TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, radius_m INTEGER NOT NULL, note TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','withdrawn')),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 0,
  review_note TEXT, reviewer_id TEXT REFERENCES users(id)
) STRICT;
CREATE TABLE safety_monitor_commands (
  owner_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, fingerprint TEXT NOT NULL,
  PRIMARY KEY(owner_id,key)
) STRICT;
