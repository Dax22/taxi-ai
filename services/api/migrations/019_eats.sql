-- Eats owns stores, memberships, menus, checked quotes and order fulfillment.
CREATE TABLE eats_stores (
  id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('pending','approved','suspended')),
  version INTEGER NOT NULL DEFAULT 0, is_open INTEGER NOT NULL DEFAULT 0 CHECK(is_open IN (0,1)),
  details_json TEXT NOT NULL, review_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE eats_memberships (
  user_id TEXT PRIMARY KEY REFERENCES users(id), store_id TEXT NOT NULL REFERENCES eats_stores(id),
  role TEXT NOT NULL CHECK(role = 'owner')
) STRICT;
CREATE INDEX eats_store_members ON eats_memberships(store_id);
CREATE TABLE eats_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL REFERENCES eats_stores(id),
  reviewer_id TEXT NOT NULL REFERENCES users(id), decision TEXT NOT NULL, reason TEXT NOT NULL,
  reference TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE eats_menu (
  id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES eats_stores(id),
  available INTEGER NOT NULL CHECK(available IN (0,1)), details_json TEXT NOT NULL
) STRICT;
CREATE INDEX eats_store_menu ON eats_menu(store_id,id);
CREATE TABLE eats_quotes (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES users(id), store_id TEXT NOT NULL REFERENCES eats_stores(id),
  store_version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, expires_at INTEGER NOT NULL, order_id TEXT
) STRICT;
CREATE INDEX eats_quote_expiry ON eats_quotes(expires_at);
CREATE TABLE eats_orders (
  id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES eats_stores(id), customer_id TEXT NOT NULL REFERENCES users(id),
  courier_id TEXT REFERENCES users(id), status TEXT NOT NULL CHECK(status IN ('placed','accepted','preparing','ready','assigned','picked_up','arrived','delivered','cancelled','rejected')),
  version INTEGER NOT NULL DEFAULT 0, snapshot_json TEXT NOT NULL, courier_json TEXT,
  pickup_pin TEXT, delivery_pin TEXT, pin_failures INTEGER NOT NULL DEFAULT 0, pin_blocked_until INTEGER,
  events_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX eats_one_courier_job ON eats_orders(courier_id) WHERE status IN ('assigned','picked_up','arrived');
CREATE INDEX eats_customer_orders ON eats_orders(customer_id,created_at DESC,id DESC);
CREATE INDEX eats_store_orders ON eats_orders(store_id,created_at DESC,id DESC);
CREATE INDEX eats_courier_orders ON eats_orders(courier_id,created_at DESC,id DESC);
CREATE INDEX eats_ready_orders ON eats_orders(status,created_at,id);
CREATE TABLE eats_commands (
  actor_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(actor_id,key)
) STRICT;
