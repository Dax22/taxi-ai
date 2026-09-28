-- Fare records remain unchanged. A trip starts only after explicit confirmation.
CREATE TABLE ride_trips (
  ride_id TEXT PRIMARY KEY REFERENCES rides(id),
  customer_id TEXT NOT NULL REFERENCES users(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('booked', 'on_way', 'arrived', 'in_progress', 'completed', 'cancelled')),
  fare_kobo INTEGER NOT NULL CHECK (fare_kobo > 0),
  booked_at INTEGER NOT NULL,
  departed_at INTEGER,
  arrived_at INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  pickup_pin TEXT,
  pin_failures INTEGER NOT NULL DEFAULT 0 CHECK (pin_failures BETWEEN 0 AND 5),
  pin_blocked_until INTEGER,
  CHECK (driver_id <> customer_id),
  CHECK ((status IN ('booked', 'on_way', 'arrived') AND pickup_pin IS NOT NULL AND length(pickup_pin) = 6 AND pickup_pin NOT GLOB '*[^0-9]*')
    OR (status IN ('in_progress', 'completed', 'cancelled') AND pickup_pin IS NULL)),
  CHECK (status NOT IN ('on_way', 'arrived', 'in_progress', 'completed') OR departed_at IS NOT NULL),
  CHECK (status NOT IN ('arrived', 'in_progress', 'completed') OR arrived_at IS NOT NULL),
  CHECK (status NOT IN ('in_progress', 'completed') OR started_at IS NOT NULL),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
) STRICT;
CREATE UNIQUE INDEX one_customer_trip ON ride_trips(customer_id) WHERE status NOT IN ('completed', 'cancelled');
CREATE UNIQUE INDEX one_driver_trip ON ride_trips(driver_id) WHERE status NOT IN ('completed', 'cancelled');

CREATE TABLE ride_activity (
  id INTEGER PRIMARY KEY,
  ride_id TEXT NOT NULL REFERENCES rides(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('booked', 'on_way', 'arrived', 'in_progress', 'completed', 'cancelled')),
  reason TEXT CHECK (reason IN ('plans_changed', 'pickup_problem', 'other')),
  created_at INTEGER NOT NULL,
  CHECK ((type = 'cancelled' AND reason IS NOT NULL) OR (type <> 'cancelled' AND reason IS NULL))
) STRICT;
CREATE INDEX ride_activity_ride ON ride_activity(ride_id, id);

-- Failed PIN submissions are committed and replayed without spending attempts twice.
ALTER TABLE idempotency ADD COLUMN error_code TEXT CHECK (error_code IS NULL OR error_code = 'INVALID_PICKUP_PIN');
