-- Existing sellers remain restaurants, with delivery and unlimited menu stock.
UPDATE eats_stores SET details_json = json_set(details_json,
  '$.sellerType', COALESCE(json_extract(details_json, '$.sellerType'), 'restaurant'),
  '$.deliveryEnabled', json('true'), '$.pickupEnabled', json('false'));
UPDATE eats_menu SET details_json = json_set(details_json,
  '$.portionsRemaining', NULL, '$.allergens', '', '$.photoId', NULL);
CREATE TABLE eats_photos (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES eats_stores(id),
  base64 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX eats_photos_store ON eats_photos(store_id);
