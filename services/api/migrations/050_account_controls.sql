-- Application moderation only. Account history and identity records are retained.
CREATE TABLE IF NOT EXISTS account_restrictions (
 id TEXT PRIMARY KEY, subject_type TEXT NOT NULL CHECK(subject_type IN ('account','store')),
 subject_id TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('customer','driver','vendor','vehicle','account','store')),
 kind TEXT NOT NULL CHECK(kind IN ('warning','suspension')),
 status TEXT NOT NULL CHECK(status IN ('active','lifted','expired')),
 reason_code TEXT NOT NULL, private_reason TEXT NOT NULL, notice TEXT NOT NULL,
 case_reference TEXT NOT NULL, expires_at INTEGER, review_at INTEGER NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id), updated_by TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL CHECK(version>=1)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS restriction_active_scope ON account_restrictions(subject_type,subject_id,scope) WHERE status='active' AND kind='suspension';
CREATE INDEX IF NOT EXISTS restriction_subject ON account_restrictions(subject_type,subject_id,status,expires_at);
CREATE TABLE IF NOT EXISTS restriction_events (
 id TEXT PRIMARY KEY, restriction_id TEXT NOT NULL REFERENCES account_restrictions(id),
 actor_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, detail_json TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS restriction_history ON restriction_events(restriction_id,created_at,id);
CREATE TABLE IF NOT EXISTS restriction_appeals (
 id TEXT PRIMARY KEY, restriction_id TEXT NOT NULL UNIQUE REFERENCES account_restrictions(id),
 user_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('submitted','upheld','overturned')),
 decision_note TEXT, decided_by TEXT REFERENCES users(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL CHECK(version>=1)
) STRICT;
CREATE INDEX IF NOT EXISTS restriction_appeal_queue ON restriction_appeals(status,created_at,id);
