-- Private comparison evidence, never biometric templates or duplicate document bytes.
CREATE TABLE driver_face_checks (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES driver_applications(driver_id) DEFERRABLE INITIALLY DEFERRED,
  application_version INTEGER NOT NULL CHECK(application_version>=0),
  documents_json TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consented_at BIGINT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','matched','needs_review','unavailable','superseded')),
  reason TEXT,
  similarity DOUBLE PRECISION CHECK(similarity IS NULL OR (similarity>=0 AND similarity<=100)),
  threshold DOUBLE PRECISION NOT NULL CHECK(threshold>=90 AND threshold<=100),
  started_at BIGINT NOT NULL,
  checked_at BIGINT
);
CREATE INDEX driver_face_attempts ON driver_face_checks(driver_id,started_at DESC,id);
CREATE UNIQUE INDEX driver_face_current ON driver_face_checks(driver_id) WHERE status<>'superseded';
