-- Invitations reserve a conversation opportunity, never a fare or a booking.
CREATE TABLE dispatch_offers (
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL REFERENCES rides(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  availability_id TEXT NOT NULL REFERENCES driver_availability(id),
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','expired','revoked')),
  mode TEXT NOT NULL CHECK (mode IN ('sequential','batch')),
  policy_version TEXT NOT NULL,
  eta_source TEXT NOT NULL CHECK (eta_source IN ('road','distance_fallback','sample')),
  pickup_eta_seconds REAL,
  estimated_at INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  closed_at INTEGER,
  CHECK ((eta_source='road' AND pickup_eta_seconds >= 0 AND estimated_at IS NOT NULL)
    OR (eta_source!='road' AND pickup_eta_seconds IS NULL AND estimated_at IS NULL)),
  CHECK ((status='pending' AND closed_at IS NULL) OR (status!='pending' AND closed_at IS NOT NULL)),
  UNIQUE (ride_id,driver_id)
) STRICT;
CREATE UNIQUE INDEX dispatch_one_ride ON dispatch_offers(ride_id) WHERE status='pending';
CREATE UNIQUE INDEX dispatch_one_driver ON dispatch_offers(driver_id) WHERE status='pending';
CREATE INDEX dispatch_pending_expiry ON dispatch_offers(expires_at) WHERE status='pending';
CREATE TABLE dispatch_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  offer_id TEXT NOT NULL REFERENCES dispatch_offers(id),
  PRIMARY KEY (actor_id,key)
) STRICT;
-- Aggregate reporting reads these timestamps, not coordinates or personal details.
CREATE TABLE dispatch_journeys (
  ride_id TEXT PRIMARY KEY REFERENCES rides(id),
  mode TEXT NOT NULL CHECK (mode IN ('legacy','sequential','batch')),
  location_mode TEXT NOT NULL CHECK (location_mode IN ('sample','gps')),
  created_at INTEGER NOT NULL,
  matched_at INTEGER,
  booked_at INTEGER,
  departed_at INTEGER,
  arrived_at INTEGER,
  completed_at INTEGER,
  closed_at INTEGER,
  outcome TEXT CHECK (outcome IN ('cancelled','expired'))
) STRICT;
CREATE INDEX dispatch_journey_cohort ON dispatch_journeys(created_at,mode,location_mode);
