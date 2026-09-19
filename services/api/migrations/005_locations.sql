CREATE TABLE location_quotes (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  route_json TEXT NOT NULL,
  ride_id TEXT UNIQUE REFERENCES rides(id)
) STRICT;
CREATE INDEX location_quotes_customer ON location_quotes(customer_id, created_at);
CREATE TABLE location_quote_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  quote_id TEXT NOT NULL REFERENCES location_quotes(id) ON DELETE CASCADE,
  PRIMARY KEY (actor_id, key)
) STRICT;

CREATE TABLE location_shares (
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL REFERENCES rides(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  session_hash TEXT,
  client_hash TEXT,
  started_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  stopped_at INTEGER,
  sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  position_json TEXT,
  CHECK (active = 1 OR (position_json IS NULL AND session_hash IS NULL AND client_hash IS NULL AND stopped_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX one_location_share_per_ride ON location_shares(ride_id) WHERE active = 1;
CREATE UNIQUE INDEX one_location_share_per_driver ON location_shares(driver_id) WHERE active = 1;
CREATE INDEX location_shares_ride ON location_shares(ride_id, started_at);
CREATE TABLE location_share_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  share_id TEXT NOT NULL REFERENCES location_shares(id),
  PRIMARY KEY (actor_id, key)
) STRICT;
