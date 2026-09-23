-- Store seller-uploaded menu photos separately from searchable menu details.
CREATE TABLE eats_menu_photos (
  item_id TEXT PRIMARY KEY REFERENCES eats_menu(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES eats_stores(id),
  content BLOB NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0 AND size_bytes <= 1048576),
  version INTEGER NOT NULL CHECK(version > 0)
) STRICT;
CREATE INDEX eats_menu_photos_store ON eats_menu_photos(store_id);
