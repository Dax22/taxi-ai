-- Staff review is independent of sensor and notification transport status.
CREATE TABLE IF NOT EXISTS safety_alert_reviews (
 alert_id TEXT PRIMARY KEY REFERENCES safety_auto_alerts(id),
 state TEXT NOT NULL CHECK(state IN ('open','acknowledged','resolved','false_alarm')),
 assignee_id TEXT REFERENCES users(id),
 version INTEGER NOT NULL CHECK(version>=0),
 updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS safety_alert_review_events (
 id TEXT PRIMARY KEY,
 alert_id TEXT NOT NULL REFERENCES safety_auto_alerts(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL CHECK(action IN ('acknowledge','note','resolve','false_alarm','reopen')),
 note TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),
 created_at INTEGER NOT NULL,
 command_key TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 UNIQUE(alert_id,version),
 UNIQUE(actor_id,command_key)
) STRICT;
CREATE INDEX IF NOT EXISTS safety_alerts_admin_queue ON safety_auto_alerts(created_at,id);
CREATE INDEX IF NOT EXISTS safety_alerts_admin_kind ON safety_auto_alerts(kind,created_at,id);
CREATE INDEX IF NOT EXISTS safety_alert_review_history ON safety_alert_review_events(alert_id,version);
