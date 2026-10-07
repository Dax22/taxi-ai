CREATE TABLE IF NOT EXISTS dispatch_profile_samples (
  id TEXT PRIMARY KEY,
  region TEXT,
  sample_every BIGINT NOT NULL CHECK(sample_every>=1),
  duration_ms DOUBLE PRECISION NOT NULL CHECK(duration_ms>=0),
  query_count BIGINT NOT NULL CHECK(query_count>=0),
  query_ms DOUBLE PRECISION NOT NULL CHECK(query_ms>=0),
  query_errors BIGINT NOT NULL CHECK(query_errors>=0),
  transactions BIGINT NOT NULL CHECK(transactions>=0),
  retries BIGINT NOT NULL CHECK(retries>=0),
  failed BIGINT NOT NULL CHECK(failed IN (0,1)),
  discovery_ms DOUBLE PRECISION,
  routing_ms DOUBLE PRECISION,
  commit_ms DOUBLE PRECISION,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS dispatch_profile_created ON dispatch_profile_samples(created_at,id);
CREATE INDEX IF NOT EXISTS dispatch_profile_region ON dispatch_profile_samples(region,created_at,id);
