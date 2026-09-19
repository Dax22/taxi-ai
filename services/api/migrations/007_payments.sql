-- All records in this milestone represent simulations, never money movement.
CREATE TABLE payments (
  ride_id TEXT PRIMARY KEY REFERENCES ride_trips(ride_id),
  customer_id TEXT NOT NULL REFERENCES users(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  amount_kobo INTEGER NOT NULL CHECK (amount_kobo > 0 AND amount_kobo <= 9007199254740991),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  mode TEXT NOT NULL DEFAULT 'simulation' CHECK (mode = 'simulation'),
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'pending', 'failed', 'paid')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  current_attempt_id TEXT,
  completed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER,
  CHECK (driver_id <> customer_id),
  CHECK ((status = 'unpaid' AND current_attempt_id IS NULL) OR (status <> 'unpaid' AND current_attempt_id IS NOT NULL)),
  CHECK ((status = 'paid' AND paid_at IS NOT NULL) OR (status <> 'paid' AND paid_at IS NULL)),
  FOREIGN KEY (ride_id, current_attempt_id) REFERENCES payment_attempts(ride_id, id)
) STRICT;
CREATE INDEX payments_driver ON payments(driver_id, completed_at, ride_id);
CREATE INDEX payments_completed ON payments(completed_at, ride_id);

CREATE TABLE payment_attempts (
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL REFERENCES payments(ride_id),
  reference TEXT NOT NULL UNIQUE,
  amount_kobo INTEGER NOT NULL CHECK (amount_kobo > 0 AND amount_kobo <= 9007199254740991),
  currency TEXT NOT NULL CHECK (currency = 'NGN'),
  provider TEXT NOT NULL CHECK (provider = 'simulator'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'failed', 'succeeded')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  UNIQUE (ride_id, id),
  CHECK ((status = 'pending' AND resolved_at IS NULL) OR (status <> 'pending' AND resolved_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX one_pending_payment_attempt ON payment_attempts(ride_id) WHERE status = 'pending';
CREATE INDEX payment_attempts_ride ON payment_attempts(ride_id, created_at, id);

CREATE TABLE payment_receipts (
  ride_id TEXT PRIMARY KEY REFERENCES payments(ride_id),
  attempt_id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (ride_id, attempt_id) REFERENCES payment_attempts(ride_id, id)
) STRICT;
CREATE TABLE payment_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  ride_id TEXT NOT NULL REFERENCES payments(ride_id),
  attempt_id TEXT NOT NULL REFERENCES payment_attempts(id),
  PRIMARY KEY (actor_id, key)
) STRICT;

-- Saved completed journeys become unpaid simulations. No historical payment,
-- successful attempt, receipt or earnings settlement is invented by an upgrade.
INSERT INTO payments (ride_id, customer_id, driver_id, amount_kobo, completed_at, updated_at)
SELECT ride_id, customer_id, driver_id, fare_kobo, completed_at, completed_at
FROM ride_trips WHERE status = 'completed';
