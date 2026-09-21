ALTER TABLE rides ADD COLUMN vehicle_category TEXT NOT NULL DEFAULT 'standard'
  CHECK (vehicle_category IN ('standard', 'suv', 'van', 'truck', 'motorcycle'));
CREATE TABLE delivery_orders (
  ride_id TEXT PRIMARY KEY REFERENCES rides(id),
  details_json TEXT NOT NULL,
  dropoff_pin TEXT,
  pin_failures INTEGER NOT NULL DEFAULT 0 CHECK (pin_failures >= 0),
  pin_blocked_until INTEGER,
  verified_at INTEGER
) STRICT;

-- Broaden the existing retry outcome constraint without changing saved commands.
-- No table references idempotency; the enclosing migration transaction makes
-- replacement atomic and preserves pickup-PIN failures and all retry keys.
CREATE TABLE ride_commands_v16 (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  ride_id TEXT NOT NULL REFERENCES rides(id),
  error_code TEXT CHECK (error_code IS NULL OR error_code IN ('INVALID_PICKUP_PIN', 'INVALID_DELIVERY_PIN')),
  PRIMARY KEY (actor_id, key)
) STRICT;
INSERT INTO ride_commands_v16(actor_id,key,fingerprint,ride_id,error_code)
  SELECT actor_id,key,fingerprint,ride_id,error_code FROM idempotency;
DROP TABLE idempotency;
ALTER TABLE ride_commands_v16 RENAME TO idempotency;
