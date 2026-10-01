-- Paystack test transactions stay separate from historical local simulations.
CREATE TABLE checkout_payments (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('ride','food')),
  target_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES users(id),
  amount_kobo INTEGER NOT NULL CHECK(amount_kobo>0 AND amount_kobo<=9007199254740991),
  currency TEXT NOT NULL CHECK(currency='NGN'),
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('initializing','pending','unknown','failed','paid','refund_required')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  checkout_url TEXT,
  receipt_json TEXT,
  provider_transaction_id TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER,
  closed_at INTEGER,
  next_check_at INTEGER,
  check_count INTEGER NOT NULL DEFAULT 0 CHECK(check_count>=0),
  lease_token TEXT,
  lease_until INTEGER,
  last_error TEXT,
  UNIQUE(kind,target_id),
  CHECK((status IN ('paid','refund_required') AND paid_at IS NOT NULL AND receipt_json IS NOT NULL) OR (status NOT IN ('paid','refund_required') AND paid_at IS NULL AND receipt_json IS NULL))
) STRICT;
CREATE INDEX checkout_payments_due ON checkout_payments(next_check_at,id) WHERE next_check_at IS NOT NULL;
CREATE INDEX checkout_payments_customer ON checkout_payments(customer_id,created_at,id);
CREATE TABLE checkout_payment_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  payment_id TEXT NOT NULL REFERENCES checkout_payments(id),
  PRIMARY KEY(actor_id,key)
) STRICT;
-- A refund review is a liability record, never a claim that money was returned.
CREATE TABLE checkout_payment_closures (
  payment_id TEXT NOT NULL REFERENCES checkout_payments(id),
  closure_key TEXT NOT NULL,
  amount_kobo INTEGER NOT NULL CHECK(amount_kobo>0 AND amount_kobo<=9007199254740991),
  reason TEXT NOT NULL,
  closed_at INTEGER NOT NULL,
  PRIMARY KEY(payment_id,closure_key)
) STRICT;

-- A later feature-flag change cannot change the payment rules of a booked trip.
ALTER TABLE ride_trips ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'simulation' CHECK(payment_mode IN ('simulation','paystack_test'));

CREATE INDEX eats_pending_payment_expiry ON eats_orders(json_extract(snapshot_json,'$.payment.expiresAt'))
  WHERE status='placed' AND json_extract(snapshot_json,'$.payment.method')='paystack' AND json_extract(snapshot_json,'$.payment.status')='pending';
