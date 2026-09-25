-- Derived availability fields support indexed expiry and local candidate lookup.
-- Coordinates remain internal and are cleared together with the underlying GPS fix.
ALTER TABLE driver_availability ADD COLUMN expires_at INTEGER;
ALTER TABLE driver_availability ADD COLUMN latitude REAL;
ALTER TABLE driver_availability ADD COLUMN longitude REAL;
UPDATE driver_availability SET
  expires_at = CASE WHEN mode = 'gps'
    THEN min(seen_at + 60000, json_extract(position_json, '$.capturedAt') + 30000)
    ELSE seen_at + 60000 END,
  latitude = json_extract(position_json, '$.lat'),
  longitude = json_extract(position_json, '$.lng')
WHERE active = 1;
CREATE INDEX availability_expiry_page ON driver_availability(expires_at, id) WHERE active = 1;
CREATE INDEX availability_active_page ON driver_availability(id) WHERE active = 1;
CREATE INDEX availability_gps_candidates ON driver_availability(latitude, longitude, id) WHERE active = 1 AND mode = 'gps';
CREATE INDEX availability_sample_candidates ON driver_availability(area_id, id) WHERE active = 1 AND mode = 'sample';
CREATE INDEX location_shares_expiry_page ON location_shares(seen_at, id) WHERE active = 1;
CREATE INDEX location_shares_active_page ON location_shares(id) WHERE active = 1;
CREATE INDEX location_quotes_prunable ON location_quotes(expires_at, id) WHERE ride_id IS NULL;
