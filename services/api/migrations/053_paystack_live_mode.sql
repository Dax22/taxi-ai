ALTER TABLE checkout_payments ADD COLUMN provider_mode TEXT NOT NULL DEFAULT 'test' CHECK(provider_mode IN ('test','live'));
CREATE INDEX checkout_payments_provider_mode ON checkout_payments(provider_mode,status,created_at,id);
