-- Staff review is independent of sensor and notification transport status.
CREATE TABLE IF NOT EXISTS safety_alert_reviews (
 alert_id TEXT PRIMARY KEY REFERENCES safety_auto_alerts(id) DEFERRABLE INITIALLY DEFERRED,
 state TEXT NOT NULL CHECK(state IN ('open','acknowledged','resolved','false_alarm')),
 assignee_id TEXT REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
 version BIGINT NOT NULL CHECK(version>=0),
 updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS safety_alert_review_events (
 id TEXT PRIMARY KEY,
 alert_id TEXT NOT NULL REFERENCES safety_auto_alerts(id) DEFERRABLE INITIALLY DEFERRED,
 actor_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
 action TEXT NOT NULL CHECK(action IN ('acknowledge','note','resolve','false_alarm','reopen')),
 note TEXT NOT NULL,
 version BIGINT NOT NULL CHECK(version>0),
 created_at BIGINT NOT NULL,
 command_key TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 UNIQUE(alert_id,version),
 UNIQUE(actor_id,command_key)
);
CREATE INDEX IF NOT EXISTS safety_alerts_admin_queue ON safety_auto_alerts(created_at,id);
CREATE INDEX IF NOT EXISTS safety_alerts_admin_kind ON safety_auto_alerts(kind,created_at,id);
CREATE INDEX IF NOT EXISTS safety_alert_review_history ON safety_alert_review_events(alert_id,version);
