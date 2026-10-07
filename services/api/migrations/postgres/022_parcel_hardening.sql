-- Intended recipient binding and delivery records; ordinary application startup never applies migrations.
ALTER TABLE parcel_tracking_links ADD COLUMN intended_email_hash TEXT;
ALTER TABLE parcel_tracking_links ADD COLUMN recipient_verified_at BIGINT;
CREATE TABLE delivery_handover_evidence (
  ride_id TEXT PRIMARY KEY REFERENCES delivery_orders(ride_id) DEFERRABLE INITIALLY DEFERRED,
  courier_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
  verified_at BIGINT NOT NULL,
  verification_method TEXT NOT NULL CHECK(verification_method='recipient_pin'),
  position_recorded INTEGER NOT NULL CHECK(position_recorded IN (0,1)),
  position_json TEXT
);
CREATE TABLE delivery_exception_events (
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL REFERENCES delivery_orders(ride_id) DEFERRABLE INITIALLY DEFERRED,
  actor_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
  kind TEXT NOT NULL CHECK(kind IN ('recipient_unavailable','incorrect_pin','damaged_parcel','failed_delivery','return_requested','return_authorized','return_received','resolved')),
  note TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  command_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  UNIQUE(ride_id,version),
  UNIQUE(actor_id,command_key)
);
CREATE INDEX delivery_exception_history ON delivery_exception_events(ride_id,created_at,id);
