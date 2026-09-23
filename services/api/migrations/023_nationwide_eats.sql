-- Dispatch coordinates are private business data, never part of a public store
-- profile or order snapshot. Existing stores/orders receive no guessed location.
CREATE TABLE eats_store_dispatch_points (
  store_id TEXT PRIMARY KEY REFERENCES eats_stores(id),
  lat REAL NOT NULL CHECK(lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK(lng BETWEEN -180 AND 180)
) STRICT;
CREATE TABLE eats_order_dispatch_points (
  order_id TEXT PRIMARY KEY REFERENCES eats_orders(id),
  lat REAL NOT NULL CHECK(lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK(lng BETWEEN -180 AND 180)
) STRICT;
CREATE INDEX eats_store_area ON eats_stores(json_extract(details_json, '$.areaId'), status, created_at DESC);
CREATE INDEX eats_ready_area ON eats_orders(status, json_extract(snapshot_json, '$.restaurant.areaId'), created_at);
