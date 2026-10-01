-- Delivery preferences stay scoped to the customer; orders keep immutable copies.
CREATE TABLE eats_delivery_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  version INTEGER NOT NULL CHECK(version > 0),
  addresses_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
