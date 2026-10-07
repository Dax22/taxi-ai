CREATE TABLE IF NOT EXISTS dispatch_ml_decisions (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  ride_id TEXT NOT NULL REFERENCES rides(id) DEFERRABLE INITIALLY IMMEDIATE,
  driver_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY IMMEDIATE,
  region TEXT NOT NULL,
  model_version TEXT NOT NULL,
  rollout_mode TEXT NOT NULL CHECK(rollout_mode IN ('shadow','live')),
  score DOUBLE PRECISION NOT NULL CHECK(score>=0 AND score<=1),
  deterministic_rank BIGINT NOT NULL CHECK(deterministic_rank>0),
  model_rank BIGINT NOT NULL CHECK(model_rank>0),
  selected_control BIGINT NOT NULL CHECK(selected_control IN (0,1)),
  selected_model BIGINT NOT NULL CHECK(selected_model IN (0,1)),
  selected_actual BIGINT NOT NULL CHECK(selected_actual IN (0,1)),
  features_json TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  offer_id TEXT REFERENCES dispatch_offers(id) DEFERRABLE INITIALLY IMMEDIATE,
  UNIQUE(cycle_id,ride_id,driver_id)
);
CREATE INDEX IF NOT EXISTS dispatch_ml_created ON dispatch_ml_decisions(created_at,id);
CREATE INDEX IF NOT EXISTS dispatch_ml_offer ON dispatch_ml_decisions(offer_id) WHERE offer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dispatch_ml_model ON dispatch_ml_decisions(model_version,rollout_mode,created_at,id);
