-- Sharing is directed, explicit per trip, and read-only. Adult acknowledgement is not age verification.
CREATE TABLE family_adults (
 user_id TEXT PRIMARY KEY REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED, confirmed_at BIGINT NOT NULL
);
CREATE TABLE family_contacts (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED, observer_id TEXT REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
 invited_email TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','active','declined','revoked','expired')),
 version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0), created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
 updated_at BIGINT NOT NULL, CHECK(owner_id<>observer_id)
);
CREATE UNIQUE INDEX family_contact_open ON family_contacts(owner_id,invited_email) WHERE status IN ('pending','active');
CREATE INDEX family_contact_observer ON family_contacts(observer_id,status,created_at);
CREATE INDEX family_contact_expiry ON family_contacts(expires_at,id) WHERE status='pending';
CREATE INDEX family_contact_owner ON family_contacts(owner_id,status,created_at);
CREATE TABLE family_shares (
 id TEXT PRIMARY KEY, contact_id TEXT NOT NULL REFERENCES family_contacts(id) DEFERRABLE INITIALLY DEFERRED, ride_id TEXT NOT NULL REFERENCES rides(id) DEFERRABLE INITIALLY DEFERRED,
 owner_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED, observer_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
 active BIGINT NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0),
 created_at BIGINT NOT NULL, ended_at BIGINT, reason TEXT CHECK(reason IN ('revoked','completed','cancelled','snapshot_reset')),
 CHECK((active=1 AND ended_at IS NULL AND reason IS NULL) OR (active=0 AND ended_at IS NOT NULL AND reason IS NOT NULL))
);
CREATE UNIQUE INDEX family_share_active ON family_shares(contact_id,ride_id) WHERE active=1;
CREATE INDEX family_share_owner ON family_shares(owner_id,created_at);
CREATE INDEX family_share_observer ON family_shares(observer_id,created_at);
CREATE INDEX family_share_ride ON family_shares(ride_id,active);
CREATE TABLE family_trip_state (
 ride_id TEXT PRIMARY KEY REFERENCES rides(id) DEFERRABLE INITIALLY DEFERRED, requested_at BIGINT, responded_at BIGINT,
 response TEXT CHECK(response IN ('okay','help','arrived')), safe_arrival_at BIGINT
);
CREATE TABLE family_events (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED, contact_id TEXT NOT NULL REFERENCES family_contacts(id) DEFERRABLE INITIALLY DEFERRED,
 share_id TEXT REFERENCES family_shares(id) DEFERRABLE INITIALLY DEFERRED, kind TEXT NOT NULL, title TEXT NOT NULL, created_at BIGINT NOT NULL,
 acknowledged_at BIGINT, dedupe_key TEXT NOT NULL, UNIQUE(user_id,dedupe_key)
);
CREATE INDEX family_events_user ON family_events(user_id,created_at);
CREATE TABLE family_commands (
 actor_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED, key TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at BIGINT NOT NULL,
 PRIMARY KEY(actor_id,key)
);
