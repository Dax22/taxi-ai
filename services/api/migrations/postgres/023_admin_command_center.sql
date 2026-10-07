-- Additive operational workflow and reporting records. No production data edits.
CREATE TABLE IF NOT EXISTS admin_work_items (
 id TEXT PRIMARY KEY, entity_type TEXT NOT NULL CHECK(entity_type IN ('ride','courier','food','account','store')),
 entity_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('support','safety','refund_review','return_review','redelivery_review','damaged_item','missing_item','assignment_review','compliance')),
 category TEXT NOT NULL CHECK(category IN ('operations','support','safety','finance')),
 title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','in_progress','waiting','resolved','rejected')),
 priority TEXT NOT NULL CHECK(priority IN ('normal','high','urgent')), assignee_id TEXT REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
 due_at BIGINT NOT NULL, first_responded_at BIGINT, resolved_at BIGINT,
 created_by TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
 version BIGINT NOT NULL CHECK(version>=1)
);
CREATE INDEX IF NOT EXISTS work_queue ON admin_work_items(category,status,created_at,id);
CREATE INDEX IF NOT EXISTS work_entity ON admin_work_items(entity_type,entity_id,created_at,id);
CREATE TABLE IF NOT EXISTS admin_work_events (
 id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES admin_work_items(id) DEFERRABLE INITIALLY DEFERRED, actor_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
 action TEXT NOT NULL, body TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_command_keys (
 actor_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED, command_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
 result_json TEXT NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY(actor_id,command_key)
);
CREATE TABLE IF NOT EXISTS admin_report_definitions (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED, title TEXT NOT NULL,
 filters_json TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
 version BIGINT NOT NULL CHECK(version>=1)
);
CREATE TABLE IF NOT EXISTS admin_campaign_drafts (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, service TEXT NOT NULL CHECK(service IN ('ride','courier','food')),
 budget_kobo BIGINT NOT NULL CHECK(budget_kobo>0), discount_kobo BIGINT NOT NULL CHECK(discount_kobo>0 AND discount_kobo<=budget_kobo),
 status TEXT NOT NULL CHECK(status IN ('draft','archived')), note TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
 version BIGINT NOT NULL CHECK(version>=1)
);

CREATE TABLE IF NOT EXISTS admin_access_events (
 id BIGSERIAL PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED, action TEXT NOT NULL, subject_id TEXT NOT NULL, detail TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_access_history ON admin_access_events(created_at,id);
