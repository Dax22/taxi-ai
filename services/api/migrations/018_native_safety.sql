-- Preserve every existing web link while adding a distinct, stable native-device binding.
-- Session references deliberately have no FK: expired device records may be purged,
-- and access checks then invalidate their links without deleting historical link rows.
CREATE TABLE trip_share_links_v18 (
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL REFERENCES rides(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT UNIQUE,
  session_hash TEXT,
  native_session_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ended_at INTEGER,
  reason TEXT CHECK(reason IN ('revoked','replaced','expired','session_ended','trip_ended','snapshot_reset')),
  CHECK((active=1 AND token_hash IS NOT NULL AND ended_at IS NULL
      AND ((session_hash IS NOT NULL AND native_session_id IS NULL)
        OR (session_hash IS NULL AND native_session_id IS NOT NULL)))
    OR (active=0 AND token_hash IS NULL AND session_hash IS NULL AND native_session_id IS NULL AND ended_at IS NOT NULL))
) STRICT;
INSERT INTO trip_share_links_v18 (id,ride_id,owner_id,token_hash,session_hash,active,version,created_at,expires_at,ended_at,reason)
  SELECT id,ride_id,owner_id,token_hash,session_hash,active,version,created_at,expires_at,ended_at,reason FROM trip_share_links;
DROP TABLE trip_share_links;
ALTER TABLE trip_share_links_v18 RENAME TO trip_share_links;
CREATE UNIQUE INDEX one_trip_link ON trip_share_links(owner_id,ride_id) WHERE active=1;
CREATE INDEX native_trip_links ON trip_share_links(native_session_id) WHERE active=1;
