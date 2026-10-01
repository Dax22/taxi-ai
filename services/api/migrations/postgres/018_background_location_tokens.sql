CREATE TABLE background_location_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('ride','food')),
  job_id TEXT NOT NULL,
  share_id TEXT NOT NULL,
  driver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  session_id TEXT NOT NULL REFERENCES device_sessions(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  client_id TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  UNIQUE(driver_id,session_id)
);
CREATE INDEX background_location_expiry ON background_location_tokens(expires_at);
CREATE FUNCTION revoke_background_location() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.revoked_at IS NOT NULL THEN DELETE FROM background_location_tokens WHERE session_id=NEW.id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER background_location_revoke AFTER UPDATE OF revoked_at ON device_sessions
FOR EACH ROW EXECUTE FUNCTION revoke_background_location();
