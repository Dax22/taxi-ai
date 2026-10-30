-- Same review-only contract as SQLite migration 060.
CREATE TABLE ride_integrity_signals (
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL REFERENCES rides(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('tracking_gap_after_arrival','cancelled_after_arrival')),
  observed_at BIGINT NOT NULL,
  arrived_at BIGINT NOT NULL,
  last_location_at BIGINT,
  cancellation_actor_id TEXT REFERENCES users(id),
  cancellation_reason TEXT,
  review_status TEXT NOT NULL DEFAULT 'open' CHECK(review_status IN ('open','reviewed','dismissed')),
  review_note TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at BIGINT,
  version BIGINT NOT NULL DEFAULT 1 CHECK(version > 0),
  UNIQUE(ride_id,kind)
);
CREATE INDEX ride_integrity_queue ON ride_integrity_signals(review_status,observed_at DESC,id DESC);
CREATE INDEX ride_integrity_driver ON ride_integrity_signals(driver_id,observed_at DESC);

CREATE TABLE ride_integrity_review_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  signal_id TEXT NOT NULL REFERENCES ride_integrity_signals(id),
  PRIMARY KEY(actor_id,key)
);
