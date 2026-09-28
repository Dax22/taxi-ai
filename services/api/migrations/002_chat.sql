CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL REFERENCES rides(id),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  sender_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at INTEGER NOT NULL,
  UNIQUE (ride_id, sequence)
) STRICT;

CREATE TABLE chat_reads (
  ride_id TEXT NOT NULL REFERENCES rides(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  through_sequence INTEGER NOT NULL CHECK (through_sequence >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (ride_id, user_id)
) STRICT;

CREATE TABLE chat_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  message_id TEXT NOT NULL REFERENCES chat_messages(id),
  PRIMARY KEY (actor_id, key)
) STRICT;

CREATE TABLE chat_reports (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES chat_messages(id),
  reporter_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (reason IN ('harassment', 'unsafe_request', 'spam', 'other')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed')),
  created_at INTEGER NOT NULL,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at INTEGER,
  UNIQUE (message_id, reporter_id)
) STRICT;
CREATE INDEX chat_reports_queue ON chat_reports(status, created_at);
