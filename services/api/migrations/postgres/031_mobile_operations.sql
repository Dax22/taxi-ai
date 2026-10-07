CREATE TABLE IF NOT EXISTS mobile_device_health (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY IMMEDIATE,
  platform TEXT NOT NULL CHECK(platform IN ('ios','android')),
  app_version TEXT NOT NULL,
  native_build BIGINT NOT NULL CHECK(native_build>=1),
  eas_build_id TEXT,
  build_profile TEXT,
  git_commit TEXT,
  os_version TEXT NOT NULL,
  location_permission TEXT NOT NULL CHECK(location_permission IN ('granted','denied','unknown')),
  background_location_permission TEXT NOT NULL CHECK(background_location_permission IN ('granted','denied','unknown')),
  notification_permission TEXT NOT NULL CHECK(notification_permission IN ('granted','denied','unknown')),
  first_seen_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS mobile_device_health_user ON mobile_device_health(user_id,last_seen_at DESC);
CREATE INDEX IF NOT EXISTS mobile_device_health_release ON mobile_device_health(platform,native_build,last_seen_at DESC);

CREATE TABLE IF NOT EXISTS mobile_api_samples (
  id BIGSERIAL PRIMARY KEY,
  route_class TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('GET','POST')),
  status_code INTEGER NOT NULL CHECK(status_code>=100 AND status_code<=599),
  duration_ms INTEGER NOT NULL CHECK(duration_ms>=0 AND duration_ms<=120000),
  sample_weight INTEGER NOT NULL CHECK(sample_weight>=1 AND sample_weight<=1000),
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS mobile_api_samples_created ON mobile_api_samples(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS mobile_api_samples_route ON mobile_api_samples(route_class,created_at DESC);

CREATE TABLE IF NOT EXISTS mobile_admin_commands (
  actor_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY IMMEDIATE,
  command_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY(actor_id,command_key)
);
