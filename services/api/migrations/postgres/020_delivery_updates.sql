-- Kemmy delivery updates are separate from ride-only notifications.
ALTER TABLE delivery_orders ADD COLUMN arrived_at BIGINT;
CREATE TABLE delivery_updates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY IMMEDIATE,
  kind TEXT NOT NULL CHECK(kind IN ('food','parcel')),
  target_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('picked_up','arrived','delivered')),
  event_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  note TEXT NOT NULL,
  eta_minutes BIGINT CHECK(eta_minutes>0 AND eta_minutes<=2880),
  created_at BIGINT NOT NULL,
  read_at BIGINT,
  route_json TEXT,
  eta_state TEXT NOT NULL CHECK(eta_state IN ('pending','done')),
  eta_attempts BIGINT NOT NULL DEFAULT 0 CHECK(eta_attempts>=0),
  eta_next_at BIGINT NOT NULL,
  eta_lease_until BIGINT NOT NULL DEFAULT 0,
  UNIQUE(user_id,event_key),
  UNIQUE(user_id,kind,target_id,phase),
  CHECK(eta_state='pending' OR route_json IS NULL)
);
CREATE INDEX delivery_updates_owner ON delivery_updates(user_id,created_at DESC,id DESC);
CREATE INDEX delivery_updates_target ON delivery_updates(user_id,kind,target_id,created_at DESC,id DESC);
CREATE INDEX delivery_updates_eta_due ON delivery_updates(eta_next_at,id) WHERE eta_state='pending';
CREATE TABLE delivery_update_push_jobs (
  id TEXT PRIMARY KEY,
  update_id TEXT NOT NULL REFERENCES delivery_updates(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  user_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY IMMEDIATE,
  session_id TEXT NOT NULL REFERENCES device_sessions(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','ticket','done','failed','suppressed')),
  attempts BIGINT NOT NULL DEFAULT 0 CHECK(attempts>=0),
  next_at BIGINT NOT NULL,
  lease_until BIGINT NOT NULL DEFAULT 0,
  ticket TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE(update_id,session_id)
);
CREATE INDEX delivery_update_push_due ON delivery_update_push_jobs(next_at,id) WHERE status IN ('queued','ticket');
CREATE FUNCTION realtime_delivery_update_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO account_revisions(user_id,revision,updated_at)
  VALUES(NEW.user_id,1,(extract(epoch FROM clock_timestamp())*1000)::bigint)
  ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at;
  RETURN NEW;
END;
$$;
CREATE TRIGGER realtime_delivery_update_insert AFTER INSERT ON delivery_updates FOR EACH ROW EXECUTE FUNCTION realtime_delivery_update_fn();
CREATE TRIGGER realtime_delivery_update_change AFTER UPDATE OF body,read_at ON delivery_updates FOR EACH ROW EXECUTE FUNCTION realtime_delivery_update_fn();
