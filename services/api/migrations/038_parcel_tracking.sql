-- Invitations are single-recipient grants. Expiry limits claiming, not an accepted recipient's delivery history.
CREATE TABLE parcel_tracking_links (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  ride_id TEXT NOT NULL REFERENCES delivery_orders(ride_id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT UNIQUE,
  recipient_id TEXT REFERENCES users(id),
  claimed_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+604800000),
  ended_at INTEGER,
  reason TEXT CHECK(reason IN ('revoked','replaced','snapshot_reset')),
  CHECK(recipient_id IS NULL AND claimed_at IS NULL OR recipient_id IS NOT NULL AND claimed_at IS NOT NULL AND recipient_id<>owner_id),
  CHECK(active=1 AND token_hash IS NOT NULL AND ended_at IS NULL AND reason IS NULL
    OR active=0 AND token_hash IS NULL AND ended_at IS NOT NULL AND reason IS NOT NULL)
) STRICT;
CREATE UNIQUE INDEX one_parcel_tracking_link ON parcel_tracking_links(ride_id) WHERE active=1;
CREATE INDEX parcel_tracking_history ON parcel_tracking_links(ride_id,sequence DESC);
CREATE INDEX parcel_tracking_recipient ON parcel_tracking_links(recipient_id,claimed_at DESC,id) WHERE active=1;
CREATE TABLE parcel_tracking_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  link_id TEXT NOT NULL REFERENCES parcel_tracking_links(id),
  PRIMARY KEY(actor_id,key)
) STRICT;
