CREATE TABLE admin_cases (
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL REFERENCES rides(id),
  incident_id TEXT UNIQUE REFERENCES safety_incidents(id),
  category TEXT NOT NULL CHECK(category IN ('support','safety')),
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL CHECK(priority IN ('urgent','high','normal','low')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','waiting','resolved')),
  assignee_id TEXT REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  response_due_at INTEGER NOT NULL,
  first_responded_at INTEGER,
  resolved_at INTEGER,
  CHECK(incident_id IS NULL OR category='safety'),
  CHECK((status='resolved' AND resolved_at IS NOT NULL) OR (status<>'resolved' AND resolved_at IS NULL))
) STRICT;
CREATE INDEX admin_case_queue ON admin_cases(category,status,created_at,id);
CREATE INDEX admin_case_owner ON admin_cases(assignee_id,status,created_at,id);
CREATE INDEX admin_case_trip ON admin_cases(ride_id,created_at,id);
CREATE TABLE admin_case_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES admin_cases(id),
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  note TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX admin_case_history ON admin_case_events(case_id,created_at,id);
CREATE TABLE admin_case_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  case_id TEXT NOT NULL REFERENCES admin_cases(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,key)
) STRICT;

-- Bring already-saved SOS records into the queue without copying location or contact details.
INSERT INTO admin_cases(id,ride_id,incident_id,category,subject,description,priority,status,assignee_id,created_at,updated_at,response_due_at,first_responded_at,resolved_at)
SELECT s.id,s.ride_id,s.id,'safety','Trip safety incident','Saved SOS incident linked for staff review.','urgent',
  CASE s.status WHEN 'acknowledged' THEN 'in_progress' ELSE s.status END,s.acknowledged_by,s.created_at,s.updated_at,s.created_at+900000,
  (SELECT MIN(e.created_at) FROM safety_incident_events e WHERE e.incident_id=s.id AND e.action IN ('acknowledged','resolved')),s.resolved_at
FROM safety_incidents s;
INSERT INTO admin_case_events(id,case_id,actor_id,action,note,version,created_at)
SELECT id,id,NULL,'incident_linked','Existing saved SOS incident linked during upgrade.',0,created_at FROM admin_cases;
