-- Durable, account-scoped invalidation cursors. Triggers commit with domain changes.
-- Never store coordinates, message bodies, contact details or credentials here.
CREATE TABLE account_revisions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TRIGGER realtime_rides_insert AFTER INSERT ON rides
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.customer_id AS user_id UNION SELECT NEW.driver_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_rides_update AFTER UPDATE ON rides
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.customer_id AS user_id UNION SELECT NEW.driver_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_ride_trips_insert AFTER INSERT ON ride_trips
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.customer_id AS user_id UNION SELECT NEW.driver_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_ride_trips_update AFTER UPDATE ON ride_trips
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.customer_id AS user_id UNION SELECT NEW.driver_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_payments_insert AFTER INSERT ON payments
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.customer_id AS user_id UNION SELECT NEW.driver_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_payments_update AFTER UPDATE ON payments
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.customer_id AS user_id UNION SELECT NEW.driver_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_dispatch_offers_insert AFTER INSERT ON dispatch_offers
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.driver_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_dispatch_offers_update AFTER UPDATE ON dispatch_offers
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.driver_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_driver_availability_insert AFTER INSERT ON driver_availability
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.driver_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_driver_availability_update AFTER UPDATE OF active ON driver_availability
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.driver_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_driver_applications_insert AFTER INSERT ON driver_applications
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.driver_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_driver_applications_update AFTER UPDATE ON driver_applications
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.driver_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_account_notifications_insert AFTER INSERT ON account_notifications
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.user_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_account_notifications_update AFTER UPDATE OF read_at ON account_notifications
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.user_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_vehicle_photo_checks_insert AFTER INSERT ON vehicle_photo_checks
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.owner_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_vehicle_photo_checks_update AFTER UPDATE OF state ON vehicle_photo_checks
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.owner_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_trusted_contacts_insert AFTER INSERT ON trusted_contacts
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.owner_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_trusted_contacts_update AFTER UPDATE ON trusted_contacts
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.owner_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_safety_auto_alerts_insert AFTER INSERT ON safety_auto_alerts
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.owner_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_safety_auto_alerts_update AFTER UPDATE OF status ON safety_auto_alerts
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.owner_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_safety_incidents_insert AFTER INSERT ON safety_incidents
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.reporter_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_safety_incidents_update AFTER UPDATE OF status ON safety_incidents
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.reporter_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_chat_messages_insert AFTER INSERT ON chat_messages
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT customer_id AS user_id FROM rides WHERE id=NEW.ride_id UNION SELECT driver_id AS user_id FROM rides WHERE id=NEW.ride_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_chat_reads_insert AFTER INSERT ON chat_reads
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT customer_id AS user_id FROM rides WHERE id=NEW.ride_id UNION SELECT driver_id AS user_id FROM rides WHERE id=NEW.ride_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_chat_reads_update AFTER UPDATE ON chat_reads
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT customer_id AS user_id FROM rides WHERE id=NEW.ride_id UNION SELECT driver_id AS user_id FROM rides WHERE id=NEW.ride_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_location_shares_insert AFTER INSERT ON location_shares
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT customer_id AS user_id FROM rides WHERE id=NEW.ride_id UNION SELECT driver_id AS user_id FROM rides WHERE id=NEW.ride_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_location_shares_update AFTER UPDATE OF active,position_json ON location_shares
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT customer_id AS user_id FROM rides WHERE id=NEW.ride_id UNION SELECT driver_id AS user_id FROM rides WHERE id=NEW.ride_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_voice_calls_insert AFTER INSERT ON voice_calls
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.callee_id AS user_id UNION SELECT NEW.caller_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_voice_calls_update AFTER UPDATE OF status,offer_sdp,answer_sdp ON voice_calls
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.callee_id AS user_id UNION SELECT NEW.caller_id AS user_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_eats_orders_insert AFTER INSERT ON eats_orders
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.customer_id AS user_id UNION SELECT NEW.courier_id AS user_id UNION SELECT user_id FROM eats_memberships WHERE store_id=NEW.store_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_eats_orders_update AFTER UPDATE ON eats_orders
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT NEW.customer_id AS user_id UNION SELECT NEW.courier_id AS user_id UNION SELECT user_id FROM eats_memberships WHERE store_id=NEW.store_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_safety_delivery_jobs_insert AFTER INSERT ON safety_delivery_jobs
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT owner_id AS user_id FROM safety_auto_alerts WHERE id=NEW.alert_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER realtime_safety_delivery_jobs_update AFTER UPDATE OF status ON safety_delivery_jobs
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  SELECT user_id,1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM (SELECT owner_id AS user_id FROM safety_auto_alerts WHERE id=NEW.alert_id) WHERE user_id IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
END;
