CREATE TABLE background_location_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('ride','food')),
  job_id TEXT NOT NULL,
  share_id TEXT NOT NULL,
  driver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES device_sessions(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE(driver_id,session_id)
) STRICT;
CREATE INDEX background_location_expiry ON background_location_tokens(expires_at);
CREATE TRIGGER background_location_revoke AFTER UPDATE OF revoked_at ON device_sessions
WHEN NEW.revoked_at IS NOT NULL BEGIN
  DELETE FROM background_location_tokens WHERE session_id=NEW.id;
END;
