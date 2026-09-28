CREATE TABLE device_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  access_hash TEXT NOT NULL UNIQUE,
  access_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  refreshed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX device_sessions_owner ON device_sessions(user_id, expires_at);
CREATE TABLE device_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES device_sessions(id) ON DELETE CASCADE,
  used_at INTEGER
);
CREATE INDEX device_refresh_family ON device_refresh_tokens(session_id);
