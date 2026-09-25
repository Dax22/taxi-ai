-- PostgreSQL equivalent of SQLite migrations 28–30, plus native PostGIS indexes.

-- Durable, account-scoped invalidation cursors. Triggers commit with domain changes.
-- Never store coordinates, message bodies, contact details or credentials here.
CREATE TABLE account_revisions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  revision BIGINT NOT NULL CHECK (revision >= 0),
  updated_at BIGINT NOT NULL
);



CREATE FUNCTION realtime_rides_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.customer_id AS user_id UNION SELECT NEW.driver_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_rides_insert AFTER INSERT ON rides FOR EACH ROW EXECUTE FUNCTION realtime_rides_insert_fn();

CREATE FUNCTION realtime_rides_update_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.customer_id AS user_id UNION SELECT NEW.driver_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_rides_update AFTER UPDATE ON rides FOR EACH ROW EXECUTE FUNCTION realtime_rides_update_fn();

CREATE FUNCTION realtime_ride_trips_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.customer_id AS user_id UNION SELECT NEW.driver_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_ride_trips_insert AFTER INSERT ON ride_trips FOR EACH ROW EXECUTE FUNCTION realtime_ride_trips_insert_fn();

CREATE FUNCTION realtime_ride_trips_update_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.customer_id AS user_id UNION SELECT NEW.driver_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_ride_trips_update AFTER UPDATE ON ride_trips FOR EACH ROW EXECUTE FUNCTION realtime_ride_trips_update_fn();

CREATE FUNCTION realtime_payments_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.customer_id AS user_id UNION SELECT NEW.driver_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_payments_insert AFTER INSERT ON payments FOR EACH ROW EXECUTE FUNCTION realtime_payments_insert_fn();

CREATE FUNCTION realtime_payments_update_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.customer_id AS user_id UNION SELECT NEW.driver_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_payments_update AFTER UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION realtime_payments_update_fn();

CREATE FUNCTION realtime_dispatch_offers_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.driver_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_dispatch_offers_insert AFTER INSERT ON dispatch_offers FOR EACH ROW EXECUTE FUNCTION realtime_dispatch_offers_insert_fn();

CREATE FUNCTION realtime_dispatch_offers_update_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.driver_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_dispatch_offers_update AFTER UPDATE ON dispatch_offers FOR EACH ROW EXECUTE FUNCTION realtime_dispatch_offers_update_fn();

CREATE FUNCTION realtime_driver_availability_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.driver_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_driver_availability_insert AFTER INSERT ON driver_availability FOR EACH ROW EXECUTE FUNCTION realtime_driver_availability_insert_fn();

CREATE FUNCTION realtime_driver_availability_update_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.driver_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_driver_availability_update AFTER UPDATE OF active ON driver_availability FOR EACH ROW EXECUTE FUNCTION realtime_driver_availability_update_fn();

CREATE FUNCTION realtime_driver_applications_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.driver_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_driver_applications_insert AFTER INSERT ON driver_applications FOR EACH ROW EXECUTE FUNCTION realtime_driver_applications_insert_fn();

CREATE FUNCTION realtime_driver_applications_update_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.driver_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_driver_applications_update AFTER UPDATE ON driver_applications FOR EACH ROW EXECUTE FUNCTION realtime_driver_applications_update_fn();

CREATE FUNCTION realtime_account_notifications_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.user_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_account_notifications_insert AFTER INSERT ON account_notifications FOR EACH ROW EXECUTE FUNCTION realtime_account_notifications_insert_fn();

CREATE FUNCTION realtime_account_notifications_update_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.user_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_account_notifications_update AFTER UPDATE OF read_at ON account_notifications FOR EACH ROW EXECUTE FUNCTION realtime_account_notifications_update_fn();

CREATE FUNCTION realtime_vehicle_photo_checks_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.owner_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_vehicle_photo_checks_insert AFTER INSERT ON vehicle_photo_checks FOR EACH ROW EXECUTE FUNCTION realtime_vehicle_photo_checks_insert_fn();

CREATE FUNCTION realtime_vehicle_photo_checks_update_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.owner_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_vehicle_photo_checks_update AFTER UPDATE OF state ON vehicle_photo_checks FOR EACH ROW EXECUTE FUNCTION realtime_vehicle_photo_checks_update_fn();

CREATE FUNCTION realtime_trusted_contacts_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.owner_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_trusted_contacts_insert AFTER INSERT ON trusted_contacts FOR EACH ROW EXECUTE FUNCTION realtime_trusted_contacts_insert_fn();

CREATE FUNCTION realtime_trusted_contacts_update_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.owner_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_trusted_contacts_update AFTER UPDATE ON trusted_contacts FOR EACH ROW EXECUTE FUNCTION realtime_trusted_contacts_update_fn();

CREATE FUNCTION realtime_safety_auto_alerts_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.owner_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_safety_auto_alerts_insert AFTER INSERT ON safety_auto_alerts FOR EACH ROW EXECUTE FUNCTION realtime_safety_auto_alerts_insert_fn();

CREATE FUNCTION realtime_safety_auto_alerts_update_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.owner_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_safety_auto_alerts_update AFTER UPDATE OF status ON safety_auto_alerts FOR EACH ROW EXECUTE FUNCTION realtime_safety_auto_alerts_update_fn();

CREATE FUNCTION realtime_safety_incidents_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.reporter_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_safety_incidents_insert AFTER INSERT ON safety_incidents FOR EACH ROW EXECUTE FUNCTION realtime_safety_incidents_insert_fn();

CREATE FUNCTION realtime_safety_incidents_update_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.reporter_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_safety_incidents_update AFTER UPDATE OF status ON safety_incidents FOR EACH ROW EXECUTE FUNCTION realtime_safety_incidents_update_fn();

CREATE FUNCTION realtime_chat_messages_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT customer_id AS user_id FROM rides WHERE id=NEW.ride_id UNION SELECT driver_id AS user_id FROM rides WHERE id=NEW.ride_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_chat_messages_insert AFTER INSERT ON chat_messages FOR EACH ROW EXECUTE FUNCTION realtime_chat_messages_insert_fn();

CREATE FUNCTION realtime_chat_reads_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT customer_id AS user_id FROM rides WHERE id=NEW.ride_id UNION SELECT driver_id AS user_id FROM rides WHERE id=NEW.ride_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_chat_reads_insert AFTER INSERT ON chat_reads FOR EACH ROW EXECUTE FUNCTION realtime_chat_reads_insert_fn();

CREATE FUNCTION realtime_chat_reads_update_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT customer_id AS user_id FROM rides WHERE id=NEW.ride_id UNION SELECT driver_id AS user_id FROM rides WHERE id=NEW.ride_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_chat_reads_update AFTER UPDATE ON chat_reads FOR EACH ROW EXECUTE FUNCTION realtime_chat_reads_update_fn();

CREATE FUNCTION realtime_location_shares_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT customer_id AS user_id FROM rides WHERE id=NEW.ride_id UNION SELECT driver_id AS user_id FROM rides WHERE id=NEW.ride_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_location_shares_insert AFTER INSERT ON location_shares FOR EACH ROW EXECUTE FUNCTION realtime_location_shares_insert_fn();

CREATE FUNCTION realtime_location_shares_update_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT customer_id AS user_id FROM rides WHERE id=NEW.ride_id UNION SELECT driver_id AS user_id FROM rides WHERE id=NEW.ride_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_location_shares_update AFTER UPDATE OF active,position_json ON location_shares FOR EACH ROW EXECUTE FUNCTION realtime_location_shares_update_fn();

CREATE FUNCTION realtime_voice_calls_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.callee_id AS user_id UNION SELECT NEW.caller_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_voice_calls_insert AFTER INSERT ON voice_calls FOR EACH ROW EXECUTE FUNCTION realtime_voice_calls_insert_fn();

CREATE FUNCTION realtime_voice_calls_update_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.callee_id AS user_id UNION SELECT NEW.caller_id AS user_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_voice_calls_update AFTER UPDATE OF status,offer_sdp,answer_sdp ON voice_calls FOR EACH ROW EXECUTE FUNCTION realtime_voice_calls_update_fn();

CREATE FUNCTION realtime_eats_orders_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.customer_id AS user_id UNION SELECT NEW.courier_id AS user_id UNION SELECT user_id FROM eats_memberships WHERE store_id=NEW.store_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_eats_orders_insert AFTER INSERT ON eats_orders FOR EACH ROW EXECUTE FUNCTION realtime_eats_orders_insert_fn();

CREATE FUNCTION realtime_eats_orders_update_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT NEW.customer_id AS user_id UNION SELECT NEW.courier_id AS user_id UNION SELECT user_id FROM eats_memberships WHERE store_id=NEW.store_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_eats_orders_update AFTER UPDATE ON eats_orders FOR EACH ROW EXECUTE FUNCTION realtime_eats_orders_update_fn();

CREATE FUNCTION realtime_safety_delivery_jobs_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT owner_id AS user_id FROM safety_auto_alerts WHERE id=NEW.alert_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_safety_delivery_jobs_insert AFTER INSERT ON safety_delivery_jobs FOR EACH ROW EXECUTE FUNCTION realtime_safety_delivery_jobs_insert_fn();

CREATE FUNCTION realtime_safety_delivery_jobs_update_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM (SELECT owner_id AS user_id FROM safety_auto_alerts WHERE id=NEW.alert_id) AS recipients WHERE user_id IS NOT NULL ORDER BY user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END
$taxi$;
CREATE TRIGGER realtime_safety_delivery_jobs_update AFTER UPDATE OF status ON safety_delivery_jobs FOR EACH ROW EXECUTE FUNCTION realtime_safety_delivery_jobs_update_fn();

-- Indexed availability and targeted expiry, matching SQLite migration 29.
ALTER TABLE driver_availability ADD COLUMN expires_at BIGINT;
ALTER TABLE driver_availability ADD COLUMN latitude DOUBLE PRECISION;
ALTER TABLE driver_availability ADD COLUMN longitude DOUBLE PRECISION;
UPDATE driver_availability SET
  expires_at = CASE WHEN mode = 'gps'
    THEN LEAST(seen_at + 60000, (position_json::jsonb->>'capturedAt')::bigint + 30000)
    ELSE seen_at + 60000 END,
  latitude = (position_json::jsonb->>'lat')::double precision,
  longitude = (position_json::jsonb->>'lng')::double precision
WHERE active = 1;
CREATE INDEX availability_expiry_page ON driver_availability(expires_at,id) WHERE active=1;
CREATE INDEX availability_active_page ON driver_availability(id) WHERE active=1;
CREATE INDEX availability_gps_candidates ON driver_availability(latitude,longitude,id) WHERE active=1 AND mode='gps';
CREATE INDEX availability_sample_candidates ON driver_availability(area_id,id) WHERE active=1 AND mode='sample';
CREATE INDEX location_shares_expiry_page ON location_shares(seen_at,id) WHERE active=1;
CREATE INDEX location_shares_active_page ON location_shares(id) WHERE active=1;
CREATE INDEX location_quotes_prunable ON location_quotes(expires_at,id) WHERE ride_id IS NULL;
ALTER TABLE driver_availability ADD COLUMN location geography(Point,4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography) STORED;
CREATE INDEX availability_gps_location ON driver_availability USING gist(location) WHERE active=1 AND mode='gps';
ALTER TABLE eats_store_dispatch_points ADD COLUMN location geography(Point,4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng,lat),4326)::geography) STORED;
CREATE INDEX eats_store_location ON eats_store_dispatch_points USING gist(location);
ALTER TABLE eats_order_dispatch_points ADD COLUMN location geography(Point,4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng,lat),4326)::geography) STORED;
CREATE INDEX eats_order_location ON eats_order_dispatch_points USING gist(location);

-- Region ownership and fenced worker leases, matching SQLite migration 30.
ALTER TABLE rides ADD COLUMN dispatch_region TEXT NOT NULL DEFAULT '';
UPDATE rides SET dispatch_region=COALESCE((
  SELECT 'ng:' || floor((route_json::jsonb#>>'{pickup,lat}')::numeric*20)::bigint::text || ':' ||
    floor((route_json::jsonb#>>'{pickup,lng}')::numeric*20)::bigint::text
  FROM location_quotes WHERE ride_id=rides.id
), 'sample:' || pickup_id);
CREATE INDEX rides_dispatch_region ON rides(dispatch_region,created_at,id) WHERE status='requested';
CREATE TABLE worker_leases (
  name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  fencing_token BIGINT NOT NULL CHECK(fencing_token>0),
  expires_at BIGINT NOT NULL
);
CREATE INDEX worker_lease_expiry ON worker_leases(expires_at);
CREATE TABLE taxi_import_history (
  source_hash TEXT PRIMARY KEY, source_schema BIGINT NOT NULL,
  row_counts_json TEXT NOT NULL, completed_at BIGINT NOT NULL
);
