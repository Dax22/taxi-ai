-- Push is optional. The family event remains the durable in-app record.
-- Keep delivery history when a device session/registration is removed.
CREATE TABLE family_push_jobs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES family_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','provider_accepted','delivered','failed','suppressed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  ticket TEXT,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  provider_confirmed_at INTEGER,
  delivered_at INTEGER,
  UNIQUE(event_id,session_id)
) STRICT;
CREATE INDEX family_push_due ON family_push_jobs(next_at,id)
  WHERE status='queued' OR (status='provider_accepted' AND provider_confirmed_at IS NULL);
CREATE INDEX family_push_event ON family_push_jobs(event_id,user_id);
