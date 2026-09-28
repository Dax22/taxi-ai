CREATE TABLE trusted_contacts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
  created_at INTEGER NOT NULL,
  removed_at INTEGER,
  CHECK((active=1 AND name IS NOT NULL AND phone IS NOT NULL AND removed_at IS NULL)
    OR (active=0 AND name IS NULL AND phone IS NULL AND removed_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX contact_phone ON trusted_contacts(owner_id,phone) WHERE active=1;

CREATE TABLE safety_incidents (
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL REFERENCES rides(id),
  reporter_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('need_help','possible_crash','unsafe_behaviour','other')),
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
  version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  acknowledged_by TEXT REFERENCES users(id),
  resolved_at INTEGER
) STRICT;
CREATE UNIQUE INDEX one_open_incident ON safety_incidents(ride_id,reporter_id) WHERE status<>'resolved';
CREATE INDEX safety_queue ON safety_incidents(status,created_at,id);
CREATE TABLE safety_incident_events (
  id INTEGER PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES safety_incidents(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  note TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

-- Local simulator only. Nothing in this release sends an external message.
CREATE TABLE safety_notifications (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES safety_incidents(id),
  contact_id TEXT NOT NULL REFERENCES trusted_contacts(id),
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'simulation' CHECK(mode='simulation'),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','delivered','failed','cancelled')),
  version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(incident_id,contact_id)
) STRICT;
CREATE TABLE safety_notification_events (
  id INTEGER PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES safety_notifications(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE trip_share_links (
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL REFERENCES rides(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT UNIQUE,
  session_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ended_at INTEGER,
  reason TEXT CHECK(reason IN ('revoked','replaced','expired','session_ended','trip_ended','snapshot_reset')),
  CHECK((active=1 AND token_hash IS NOT NULL AND session_hash IS NOT NULL AND ended_at IS NULL)
    OR (active=0 AND token_hash IS NULL AND session_hash IS NULL AND ended_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX one_trip_link ON trip_share_links(owner_id,ride_id) WHERE active=1;
CREATE TABLE safety_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  PRIMARY KEY(actor_id,key)
) STRICT;
