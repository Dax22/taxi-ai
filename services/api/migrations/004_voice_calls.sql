CREATE TABLE voice_calls (
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL REFERENCES rides(id),
  caller_id TEXT NOT NULL REFERENCES users(id),
  callee_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('ringing', 'connecting', 'connected', 'ended', 'declined', 'missed', 'failed')),
  mode TEXT NOT NULL CHECK (mode IN ('local', 'relay')),
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  answered_at INTEGER,
  connected_at INTEGER,
  ended_at INTEGER,
  ended_by TEXT REFERENCES users(id),
  reason TEXT,
  caller_session TEXT NOT NULL,
  callee_session TEXT,
  caller_client TEXT NOT NULL,
  callee_client TEXT,
  caller_seen_at INTEGER NOT NULL,
  callee_seen_at INTEGER,
  caller_connected INTEGER NOT NULL DEFAULT 0 CHECK (caller_connected IN (0, 1)),
  callee_connected INTEGER NOT NULL DEFAULT 0 CHECK (callee_connected IN (0, 1)),
  offer_sdp TEXT,
  answer_sdp TEXT,
  CHECK (caller_id <> callee_id),
  CHECK (status NOT IN ('connecting', 'connected') OR (answered_at IS NOT NULL AND callee_session IS NOT NULL AND callee_client IS NOT NULL)),
  CHECK (status <> 'connected' OR connected_at IS NOT NULL),
  CHECK (status IN ('ringing', 'connecting', 'connected') OR (ended_at IS NOT NULL AND offer_sdp IS NULL AND answer_sdp IS NULL))
) STRICT;
CREATE INDEX voice_calls_caller ON voice_calls(caller_id, created_at);
CREATE INDEX voice_calls_callee ON voice_calls(callee_id, created_at);
CREATE INDEX voice_calls_ride ON voice_calls(ride_id, created_at);
CREATE UNIQUE INDEX one_voice_call_per_ride ON voice_calls(ride_id) WHERE status IN ('ringing', 'connecting', 'connected');

-- A single key covers both caller and recipient, including calls on other rides.
CREATE TABLE voice_participants (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  call_id TEXT NOT NULL REFERENCES voice_calls(id)
) STRICT;
CREATE TABLE voice_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  call_id TEXT NOT NULL REFERENCES voice_calls(id),
  PRIMARY KEY (actor_id, key)
) STRICT;
