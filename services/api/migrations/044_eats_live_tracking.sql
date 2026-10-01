-- Ephemeral courier GPS is separate from dispatch availability and ride shares.
CREATE TABLE eats_location_shares (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES eats_orders(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  session_hash TEXT,
  client_hash TEXT,
  started_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  stopped_at INTEGER,
  sequence INTEGER NOT NULL DEFAULT 0 CHECK(sequence>=0),
  position_json TEXT,
  CHECK(active=1 OR (position_json IS NULL AND session_hash IS NULL AND client_hash IS NULL AND stopped_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_eats_share_per_order ON eats_location_shares(order_id) WHERE active=1;
CREATE UNIQUE INDEX one_eats_share_per_driver ON eats_location_shares(driver_id) WHERE active=1;
CREATE INDEX eats_location_expiry ON eats_location_shares(seen_at,id) WHERE active=1;
CREATE INDEX eats_location_active ON eats_location_shares(id) WHERE active=1;
CREATE TABLE eats_location_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  share_id TEXT NOT NULL REFERENCES eats_location_shares(id),
  PRIMARY KEY(actor_id,key)
);

CREATE TRIGGER eats_tracking_order_closed AFTER UPDATE OF status,courier_id ON eats_orders
WHEN NEW.status NOT IN ('assigned','picked_up','arrived') OR NEW.courier_id IS NOT OLD.courier_id
BEGIN
  UPDATE eats_location_shares SET active=0,position_json=NULL,session_hash=NULL,client_hash=NULL,stopped_at=NEW.updated_at WHERE order_id=NEW.id AND active=1;
END;
CREATE TRIGGER eats_tracking_browser_revoked AFTER DELETE ON sessions
BEGIN
  UPDATE eats_location_shares SET active=0,position_json=NULL,session_hash=NULL,client_hash=NULL,stopped_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE session_hash=OLD.token_hash AND active=1;
END;
CREATE TRIGGER eats_tracking_native_revoked AFTER UPDATE OF revoked_at ON device_sessions WHEN NEW.revoked_at IS NOT NULL
BEGIN
  UPDATE eats_location_shares SET active=0,position_json=NULL,session_hash=NULL,client_hash=NULL,stopped_at=NEW.revoked_at WHERE session_hash='native:'||NEW.id AND active=1;
END;
CREATE TRIGGER eats_tracking_native_deleted AFTER DELETE ON device_sessions
BEGIN
  UPDATE eats_location_shares SET active=0,position_json=NULL,session_hash=NULL,client_hash=NULL,stopped_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE session_hash='native:'||OLD.id AND active=1;
END;
CREATE TRIGGER realtime_eats_tracking_insert AFTER INSERT ON eats_location_shares
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT customer_id AS user_id FROM eats_orders WHERE id=NEW.order_id UNION SELECT NEW.driver_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER realtime_eats_tracking_update AFTER UPDATE ON eats_location_shares
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT customer_id AS user_id FROM eats_orders WHERE id=NEW.order_id UNION SELECT NEW.driver_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;
