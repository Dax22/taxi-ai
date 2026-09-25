-- Requests belong to one small pickup cell; nearby drivers can cross its borders.
ALTER TABLE rides ADD COLUMN dispatch_region TEXT NOT NULL DEFAULT '';
UPDATE rides SET dispatch_region=COALESCE((
  SELECT 'ng:' || CAST(json_extract(route_json,'$.pickup.lat')*20 AS INTEGER) || ':' ||
    CAST(json_extract(route_json,'$.pickup.lng')*20 AS INTEGER)
  FROM location_quotes WHERE ride_id=rides.id
), 'sample:' || pickup_id);
CREATE INDEX rides_dispatch_region ON rides(dispatch_region,created_at,id) WHERE status='requested';

-- Lease generations are never deleted, even on orderly release.
CREATE TABLE worker_leases (
  name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL CHECK (fencing_token>0),
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX worker_lease_expiry ON worker_leases(expires_at);
