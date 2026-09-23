CREATE TABLE eats_checkouts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users(id),
  quote_ids_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX eats_checkouts_customer ON eats_checkouts(customer_id);
CREATE TABLE eats_collection_points (
  order_id TEXT PRIMARY KEY REFERENCES eats_orders(id),
  location TEXT NOT NULL
) STRICT;
