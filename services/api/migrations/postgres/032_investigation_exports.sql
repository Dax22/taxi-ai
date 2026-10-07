CREATE TABLE IF NOT EXISTS investigation_exports (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY IMMEDIATE,
  service TEXT NOT NULL CHECK(service IN ('ride','courier','food')),
  transaction_id TEXT NOT NULL,
  driver_id TEXT,
  case_reference TEXT NOT NULL,
  requesting_authority TEXT NOT NULL,
  authority_reference TEXT NOT NULL,
  legal_basis TEXT NOT NULL CHECK(legal_basis IN ('court_order','warrant','documented_police_request','urgent_safety','internal_investigation')),
  purpose TEXT NOT NULL,
  included_documents BIGINT NOT NULL CHECK(included_documents IN (0,1)),
  included_messages BIGINT NOT NULL CHECK(included_messages IN (0,1)),
  manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
  archive_sha256 TEXT NOT NULL CHECK(length(archive_sha256)=64),
  archive_bytes BIGINT NOT NULL CHECK(archive_bytes>0),
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS investigation_exports_record ON investigation_exports(service,transaction_id,created_at DESC);
CREATE INDEX IF NOT EXISTS investigation_exports_actor ON investigation_exports(actor_id,created_at DESC);
