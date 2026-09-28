-- Availability is a separate, explicit consent from location sharing on a trip.
CREATE TABLE driver_availability (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES drivers(user_id),
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  mode TEXT NOT NULL CHECK (mode IN ('gps', 'sample')),
  area_id TEXT,
  position_json TEXT,
  session_hash TEXT,
  client_hash TEXT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  started_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  stopped_at INTEGER,
  reason TEXT CHECK (reason IN ('offline', 'expired', 'session_ended', 'approval_changed', 'claimed', 'snapshot_reset')),
  CHECK ((active = 1 AND session_hash IS NOT NULL AND client_hash IS NOT NULL AND stopped_at IS NULL AND reason IS NULL
    AND ((mode = 'gps' AND position_json IS NOT NULL AND area_id IS NULL) OR (mode = 'sample' AND area_id IS NOT NULL AND position_json IS NULL)))
    OR (active = 0 AND position_json IS NULL AND area_id IS NULL AND session_hash IS NULL AND client_hash IS NULL AND stopped_at IS NOT NULL AND reason IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX one_online_driver ON driver_availability(driver_id) WHERE active = 1;
CREATE INDEX availability_driver ON driver_availability(driver_id, started_at);
CREATE TABLE availability_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  availability_id TEXT NOT NULL REFERENCES driver_availability(id),
  PRIMARY KEY (actor_id, key)
) STRICT;

ALTER TABLE rides ADD COLUMN request_expires_at INTEGER;
ALTER TABLE rides ADD COLUMN closed_reason TEXT CHECK (closed_reason IS NULL OR closed_reason = 'request_expired');
-- Old unclaimed requests get the same five-minute window. Claimed rides are untouched.
UPDATE rides SET request_expires_at = created_at + 300000 WHERE status = 'requested';
CREATE INDEX rides_request_expiry ON rides(request_expires_at) WHERE status = 'requested';
