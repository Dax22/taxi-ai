-- Sharing is directed, explicit per trip, and read-only. Adult acknowledgement is not age verification.
CREATE TABLE family_adults (
 user_id TEXT PRIMARY KEY REFERENCES users(id), confirmed_at INTEGER NOT NULL
) STRICT;
CREATE TABLE family_contacts (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), observer_id TEXT REFERENCES users(id),
 invited_email TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','active','declined','revoked','expired')),
 version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL, CHECK(owner_id<>observer_id)
) STRICT;
CREATE UNIQUE INDEX family_contact_open ON family_contacts(owner_id,invited_email) WHERE status IN ('pending','active');
CREATE INDEX family_contact_observer ON family_contacts(observer_id,status,created_at);
CREATE INDEX family_contact_expiry ON family_contacts(expires_at,id) WHERE status='pending';
CREATE INDEX family_contact_owner ON family_contacts(owner_id,status,created_at);
CREATE TABLE family_shares (
 id TEXT PRIMARY KEY, contact_id TEXT NOT NULL REFERENCES family_contacts(id), ride_id TEXT NOT NULL REFERENCES rides(id),
 owner_id TEXT NOT NULL REFERENCES users(id), observer_id TEXT NOT NULL REFERENCES users(id),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
 created_at INTEGER NOT NULL, ended_at INTEGER, reason TEXT CHECK(reason IN ('revoked','completed','cancelled','snapshot_reset')),
 CHECK((active=1 AND ended_at IS NULL AND reason IS NULL) OR (active=0 AND ended_at IS NOT NULL AND reason IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX family_share_active ON family_shares(contact_id,ride_id) WHERE active=1;
CREATE INDEX family_share_owner ON family_shares(owner_id,created_at);
CREATE INDEX family_share_observer ON family_shares(observer_id,created_at);
CREATE INDEX family_share_ride ON family_shares(ride_id,active);
CREATE TABLE family_trip_state (
 ride_id TEXT PRIMARY KEY REFERENCES rides(id), requested_at INTEGER, responded_at INTEGER,
 response TEXT CHECK(response IN ('okay','help','arrived')), safe_arrival_at INTEGER
) STRICT;
CREATE TABLE family_events (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), contact_id TEXT NOT NULL REFERENCES family_contacts(id),
 share_id TEXT REFERENCES family_shares(id), kind TEXT NOT NULL, title TEXT NOT NULL, created_at INTEGER NOT NULL,
 acknowledged_at INTEGER, dedupe_key TEXT NOT NULL, UNIQUE(user_id,dedupe_key)
) STRICT;
CREATE INDEX family_events_user ON family_events(user_id,created_at);
CREATE TABLE family_commands (
 actor_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(actor_id,key)
) STRICT;
