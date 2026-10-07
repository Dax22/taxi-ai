-- Additive operational workflow and reporting records. No production data edits.
CREATE TABLE IF NOT EXISTS admin_work_items (
 id TEXT PRIMARY KEY, entity_type TEXT NOT NULL CHECK(entity_type IN ('ride','courier','food','account','store')),
 entity_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('support','safety','refund_review','return_review','redelivery_review','damaged_item','missing_item','assignment_review','compliance')),
 category TEXT NOT NULL CHECK(category IN ('operations','support','safety','finance')),
 title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','in_progress','waiting','resolved','rejected')),
 priority TEXT NOT NULL CHECK(priority IN ('normal','high','urgent')), assignee_id TEXT REFERENCES users(id),
 due_at INTEGER NOT NULL, first_responded_at INTEGER, resolved_at INTEGER,
 created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL CHECK(version>=1)
) STRICT;
CREATE INDEX IF NOT EXISTS work_queue ON admin_work_items(category,status,created_at,id);
CREATE INDEX IF NOT EXISTS work_entity ON admin_work_items(entity_type,entity_id,created_at,id);
CREATE TABLE IF NOT EXISTS admin_work_events (
 id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES admin_work_items(id), actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS admin_command_keys (
 actor_id TEXT NOT NULL REFERENCES users(id), command_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
 result_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(actor_id,command_key)
) STRICT;
CREATE TABLE IF NOT EXISTS admin_report_definitions (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
 filters_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL CHECK(version>=1)
) STRICT;
CREATE TABLE IF NOT EXISTS admin_campaign_drafts (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, service TEXT NOT NULL CHECK(service IN ('ride','courier','food')),
 budget_kobo INTEGER NOT NULL CHECK(budget_kobo>0), discount_kobo INTEGER NOT NULL CHECK(discount_kobo>0 AND discount_kobo<=budget_kobo),
 status TEXT NOT NULL CHECK(status IN ('draft','archived')), note TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL CHECK(version>=1)
) STRICT;

CREATE TABLE IF NOT EXISTS admin_access_events (
 id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, subject_id TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS admin_access_history ON admin_access_events(created_at,id);
