CREATE TABLE ride_driver_ratings (
  ride_id TEXT PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES users(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX ride_driver_ratings_driver ON ride_driver_ratings(driver_id, created_at DESC);
