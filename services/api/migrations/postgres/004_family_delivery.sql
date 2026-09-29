CREATE TABLE family_push_jobs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES family_events(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  user_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
  session_id TEXT NOT NULL,
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','provider_accepted','delivered','failed','suppressed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at BIGINT NOT NULL,
  lease_until BIGINT NOT NULL DEFAULT 0,
  ticket TEXT,
  created_at BIGINT NOT NULL,
  accepted_at BIGINT,
  provider_confirmed_at BIGINT,
  delivered_at BIGINT,
  UNIQUE(event_id,session_id)
);
CREATE INDEX family_push_due ON family_push_jobs(next_at,id)
  WHERE status='queued' OR (status='provider_accepted' AND provider_confirmed_at IS NULL);
CREATE INDEX family_push_event ON family_push_jobs(event_id,user_id);
