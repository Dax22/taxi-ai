-- Ephemeral courier GPS is separate from dispatch availability and ride shares.
CREATE TABLE eats_location_shares (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES eats_orders(id) DEFERRABLE INITIALLY IMMEDIATE,
  driver_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY IMMEDIATE,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  session_hash TEXT,
  client_hash TEXT,
  started_at BIGINT NOT NULL,
  seen_at BIGINT NOT NULL,
  stopped_at BIGINT,
  sequence INTEGER NOT NULL DEFAULT 0 CHECK(sequence>=0),
  position_json TEXT,
  CHECK(active=1 OR (position_json IS NULL AND session_hash IS NULL AND client_hash IS NULL AND stopped_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_eats_share_per_order ON eats_location_shares(order_id) WHERE active=1;
CREATE UNIQUE INDEX one_eats_share_per_driver ON eats_location_shares(driver_id) WHERE active=1;
CREATE INDEX eats_location_expiry ON eats_location_shares(seen_at,id) WHERE active=1;
CREATE INDEX eats_location_active ON eats_location_shares(id) WHERE active=1;
CREATE TABLE eats_location_commands (
  actor_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY IMMEDIATE,
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  share_id TEXT NOT NULL REFERENCES eats_location_shares(id) DEFERRABLE INITIALLY IMMEDIATE,
  PRIMARY KEY(actor_id,key)
);

-- Keep earlier additive Eats tables compatible with the deferred snapshot import.
ALTER TABLE eats_store_assets ALTER CONSTRAINT eats_store_assets_store_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE eats_store_assets ALTER CONSTRAINT eats_store_assets_photo_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE eats_photo_reviews ALTER CONSTRAINT eats_photo_reviews_store_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE eats_photo_reviews ALTER CONSTRAINT eats_photo_reviews_reviewer_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE eats_delivery_profiles ALTER CONSTRAINT eats_delivery_profiles_user_id_fkey DEFERRABLE INITIALLY IMMEDIATE;

CREATE FUNCTION eats_tracking_close_fn() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE binding TEXT; ended BIGINT;
BEGIN
  ended := (extract(epoch FROM clock_timestamp())*1000)::bigint;
  IF TG_TABLE_NAME='eats_orders' THEN
    IF NEW.status NOT IN ('assigned','picked_up','arrived') OR NEW.courier_id IS DISTINCT FROM OLD.courier_id THEN
      UPDATE eats_location_shares SET active=0,position_json=NULL,session_hash=NULL,client_hash=NULL,stopped_at=NEW.updated_at WHERE order_id=NEW.id AND active=1;
    END IF;
  ELSE
    IF TG_TABLE_NAME='sessions' THEN binding:=OLD.token_hash;
    ELSIF TG_OP='DELETE' THEN binding:='native:'||OLD.id;
    ELSE
      IF NEW.revoked_at IS NULL THEN RETURN NEW; END IF;
      binding:='native:'||NEW.id; ended:=NEW.revoked_at;
    END IF;
    UPDATE eats_location_shares SET active=0,position_json=NULL,session_hash=NULL,client_hash=NULL,stopped_at=ended WHERE session_hash=binding AND active=1;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER eats_tracking_order_closed AFTER UPDATE OF status,courier_id ON eats_orders FOR EACH ROW EXECUTE FUNCTION eats_tracking_close_fn();
CREATE TRIGGER eats_tracking_browser_revoked AFTER DELETE ON sessions FOR EACH ROW EXECUTE FUNCTION eats_tracking_close_fn();
CREATE TRIGGER eats_tracking_native_revoked AFTER UPDATE OF revoked_at ON device_sessions FOR EACH ROW EXECUTE FUNCTION eats_tracking_close_fn();
CREATE TRIGGER eats_tracking_native_deleted AFTER DELETE ON device_sessions FOR EACH ROW EXECUTE FUNCTION eats_tracking_close_fn();
CREATE FUNCTION realtime_eats_tracking_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT customer_id AS user_id FROM eats_orders WHERE id=NEW.order_id UNION SELECT NEW.driver_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END;
$$;
CREATE TRIGGER realtime_eats_tracking_insert AFTER INSERT ON eats_location_shares FOR EACH ROW EXECUTE FUNCTION realtime_eats_tracking_fn();
CREATE TRIGGER realtime_eats_tracking_update AFTER UPDATE ON eats_location_shares FOR EACH ROW EXECUTE FUNCTION realtime_eats_tracking_fn();
