CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer', 'driver', 'admin')),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE drivers (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  vehicle_model TEXT NOT NULL,
  vehicle_plate TEXT NOT NULL,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at INTEGER
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE rides (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users(id),
  driver_id TEXT REFERENCES users(id),
  pickup_id TEXT NOT NULL,
  destination_id TEXT NOT NULL CHECK (destination_id <> pickup_id),
  suggested_fare_kobo INTEGER NOT NULL CHECK (suggested_fare_kobo > 0),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'negotiating', 'agreed', 'cancelled')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at INTEGER NOT NULL,
  matched_at INTEGER,
  updated_at INTEGER NOT NULL,
  CHECK (driver_id IS NULL OR driver_id <> customer_id),
  CHECK (status NOT IN ('negotiating', 'agreed') OR (driver_id IS NOT NULL AND matched_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX one_open_customer_request ON rides(customer_id) WHERE status IN ('requested', 'negotiating');
CREATE UNIQUE INDEX one_driver_negotiation ON rides(driver_id) WHERE status = 'negotiating';
CREATE INDEX rides_available ON rides(status, created_at);
CREATE INDEX rides_driver ON rides(driver_id, created_at);

-- Only the server writes these commands. Replay uses the shared domain rules.
CREATE TABLE fare_events (
  ride_id TEXT NOT NULL REFERENCES rides(id),
  version INTEGER NOT NULL CHECK (version > 0),
  type TEXT NOT NULL CHECK (type IN ('propose', 'accept', 'cancel')),
  payload TEXT NOT NULL,
  PRIMARY KEY (ride_id, version)
) STRICT;

CREATE TABLE idempotency (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  ride_id TEXT NOT NULL REFERENCES rides(id),
  PRIMARY KEY (actor_id, key)
) STRICT;

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
) STRICT;
