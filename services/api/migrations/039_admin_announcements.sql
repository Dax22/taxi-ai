-- Staff-authored broadcasts are separate from journey notifications.
CREATE TABLE admin_announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL CHECK(audience IN ('all','customers','drivers','eats_sellers')),
  priority TEXT NOT NULL CHECK(priority IN ('normal','important','critical')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','cancelled')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_by TEXT NOT NULL REFERENCES users(id),
  published_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER,
  expires_at INTEGER NOT NULL,
  CHECK(expires_at > created_at)
) STRICT;
CREATE INDEX admin_announcements_recent ON admin_announcements(status,created_at DESC,id);

CREATE TABLE admin_announcement_reads (
  announcement_id TEXT NOT NULL REFERENCES admin_announcements(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at INTEGER NOT NULL,
  PRIMARY KEY(announcement_id,user_id)
) STRICT;
CREATE INDEX announcement_reads_user ON admin_announcement_reads(user_id,read_at DESC);

CREATE TABLE admin_announcement_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,key)
) STRICT;

CREATE TABLE announcement_push_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id TEXT NOT NULL REFERENCES admin_announcements(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES device_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ticket','done','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL,
  ticket TEXT,
  UNIQUE(announcement_id,session_id)
) STRICT;
CREATE INDEX announcement_push_due ON announcement_push_jobs(status,next_at);
