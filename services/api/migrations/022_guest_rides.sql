-- Guest identity is an immutable supplement; the ride customer remains the booker and payer.
-- Missing passenger rows mean a legacy/self booking.
CREATE TABLE guest_ride_passengers (
  ride_id TEXT PRIMARY KEY REFERENCES rides(id),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND json_extract(snapshot_json,'$.kind')='guest')
) STRICT;

CREATE TABLE guest_ride_links (
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL REFERENCES rides(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT UNIQUE,
  session_binding TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+86400000),
  ended_at INTEGER,
  reason TEXT CHECK(reason IN ('revoked','replaced','expired','session_ended','trip_ended','snapshot_reset')),
  CHECK((active=1 AND token_hash IS NOT NULL AND session_binding IS NOT NULL AND ended_at IS NULL AND reason IS NULL)
    OR (active=0 AND token_hash IS NULL AND session_binding IS NULL AND ended_at IS NOT NULL AND reason IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX one_guest_ride_link ON guest_ride_links(ride_id) WHERE active=1;
CREATE INDEX guest_ride_link_history ON guest_ride_links(ride_id,created_at);

CREATE TABLE guest_ride_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  link_id TEXT NOT NULL REFERENCES guest_ride_links(id),
  PRIMARY KEY(actor_id,key)
) STRICT;
