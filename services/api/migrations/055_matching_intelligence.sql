CREATE TABLE IF NOT EXISTS dispatch_profile_samples (
  id TEXT PRIMARY KEY,
  region TEXT,
  sample_every INTEGER NOT NULL CHECK(sample_every>=1),
  duration_ms REAL NOT NULL CHECK(duration_ms>=0),
  query_count INTEGER NOT NULL CHECK(query_count>=0),
  query_ms REAL NOT NULL CHECK(query_ms>=0),
  query_errors INTEGER NOT NULL CHECK(query_errors>=0),
  transactions INTEGER NOT NULL CHECK(transactions>=0),
  retries INTEGER NOT NULL CHECK(retries>=0),
  failed INTEGER NOT NULL CHECK(failed IN (0,1)),
  discovery_ms REAL,
  routing_ms REAL,
  commit_ms REAL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS dispatch_profile_created ON dispatch_profile_samples(created_at,id);
CREATE INDEX IF NOT EXISTS dispatch_profile_region ON dispatch_profile_samples(region,created_at,id);
