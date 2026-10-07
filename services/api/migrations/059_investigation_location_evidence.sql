CREATE TABLE investigation_location_evidence (
  resource_kind TEXT NOT NULL CHECK(resource_kind IN ('ride','food')),
  transaction_id TEXT NOT NULL,
  share_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  accuracy_meters INTEGER NOT NULL CHECK(accuracy_meters > 0 AND accuracy_meters <= 200),
  captured_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY(resource_kind,share_id,sequence)
);
CREATE INDEX investigation_location_transaction ON investigation_location_evidence(resource_kind,transaction_id,captured_at,share_id,sequence);
CREATE INDEX investigation_location_retention ON investigation_location_evidence(recorded_at,resource_kind);
ALTER TABLE investigation_exports ADD COLUMN included_location INTEGER NOT NULL DEFAULT 0 CHECK(included_location IN (0,1));
