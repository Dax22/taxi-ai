-- Read-only staff reporting uses stable keyset pages and indexed account history.
CREATE INDEX IF NOT EXISTS admin_accounts_created ON users(created_at,id);
CREATE INDEX IF NOT EXISTS admin_rides_created ON rides(created_at,id);
CREATE INDEX IF NOT EXISTS admin_customer_trips ON rides(customer_id,created_at,id);
