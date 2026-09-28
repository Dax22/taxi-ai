-- Private comparison evidence, never biometric templates or duplicate document bytes.
CREATE TABLE driver_face_checks (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES driver_applications(driver_id),
  application_version INTEGER NOT NULL CHECK(application_version>=0),
  documents_json TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consented_at INTEGER NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','matched','needs_review','unavailable','superseded')),
  reason TEXT,
  similarity REAL CHECK(similarity IS NULL OR (similarity>=0 AND similarity<=100)),
  threshold REAL NOT NULL CHECK(threshold>=90 AND threshold<=100),
  started_at INTEGER NOT NULL,
  checked_at INTEGER
) STRICT;
CREATE INDEX driver_face_attempts ON driver_face_checks(driver_id,started_at DESC,id);
CREATE UNIQUE INDEX driver_face_current ON driver_face_checks(driver_id) WHERE status<>'superseded';
