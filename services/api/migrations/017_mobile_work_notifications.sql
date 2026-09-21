-- A native lease binds to the stable device session, not its rotating access token.
ALTER TABLE driver_availability ADD COLUMN native_session_id TEXT;
CREATE TABLE account_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  ride_id TEXT NOT NULL REFERENCES rides(id),
  kind TEXT NOT NULL CHECK(kind IN ('request','claim','propose','accept','confirm','depart','arrive','start','complete','cancel','expired','message')),
  mode TEXT NOT NULL CHECK(mode IN ('customer','work')),
  event_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  UNIQUE(user_id,event_key)
) STRICT;
CREATE INDEX notifications_owner ON account_notifications(user_id,id DESC);
CREATE TABLE push_registrations (
  session_id TEXT PRIMARY KEY REFERENCES device_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE push_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER NOT NULL REFERENCES account_notifications(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES device_sessions(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ticket','done','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL,
  ticket TEXT,
  UNIQUE(notification_id,session_id)
) STRICT;
CREATE INDEX push_due ON push_jobs(status,next_at);
