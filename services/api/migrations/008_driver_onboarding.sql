CREATE TABLE driver_applications (
  driver_id TEXT PRIMARY KEY REFERENCES drivers(user_id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','changes_requested','rejected','approved')),
  version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
  details_json TEXT,
  submitted_at INTEGER,
  updated_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by TEXT REFERENCES users(id),
  review_reason TEXT,
  verification_json TEXT
) STRICT;
-- Legacy test approvals provide no verification evidence. Keep trip permissions
-- for existing work, but new work requires this application's separate eligibility.
INSERT INTO driver_applications(driver_id, updated_at)
SELECT d.user_id, u.created_at FROM drivers d JOIN users u ON u.id=d.user_id;

CREATE TABLE driver_documents (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES driver_applications(driver_id),
  kind TEXT NOT NULL CHECK(kind IN ('profile_photo','driving_licence','vehicle_registration','insurance','vehicle_photo')),
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png','image/jpeg')),
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0 AND size_bytes <= 2097152),
  sha256 TEXT NOT NULL,
  expires_on TEXT,
  content BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(driver_id,kind),
  CHECK(length(content)=size_bytes)
) STRICT;
CREATE TABLE driver_document_reads (
  document_id TEXT NOT NULL REFERENCES driver_documents(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  read_at INTEGER NOT NULL,
  PRIMARY KEY(document_id,reviewer_id)
) STRICT;
CREATE TABLE driver_application_events (
  id INTEGER PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES driver_applications(driver_id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX driver_events ON driver_application_events(driver_id,id);
CREATE TABLE driver_application_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  driver_id TEXT NOT NULL REFERENCES driver_applications(driver_id),
  PRIMARY KEY(actor_id,key)
) STRICT;

ALTER TABLE rides ADD COLUMN driver_snapshot_json TEXT;
-- Preserve the vehicle/name recorded before drivers can edit their applications.
UPDATE rides SET driver_snapshot_json = (
  SELECT json_object('id',u.id,'name',u.name,'vehicle',json_object('model',d.vehicle_model,'plate',d.vehicle_plate))
  FROM users u JOIN drivers d ON u.id=d.user_id WHERE u.id=rides.driver_id
) WHERE driver_id IS NOT NULL;
