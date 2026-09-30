-- Preserve existing vendor images as legacy content, without claiming a new review.
ALTER TABLE eats_photos ADD COLUMN purpose TEXT NOT NULL DEFAULT 'dish' CHECK(purpose IN ('dish','logo','cover','menu_reference'));
ALTER TABLE eats_photos ADD COLUMN status TEXT NOT NULL DEFAULT 'legacy-approved' CHECK(status IN ('pending','approved','rejected','legacy-approved','private'));
ALTER TABLE eats_photos ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0);
ALTER TABLE eats_photos ADD COLUMN review_note TEXT;
ALTER TABLE eats_photos ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes >= 0);
UPDATE eats_photos SET size_bytes=(length(base64)*3/4) - CASE WHEN substr(base64,-2)='==' THEN 2 WHEN substr(base64,-1)='=' THEN 1 ELSE 0 END;
CREATE INDEX eats_photo_review_queue ON eats_photos(status,created_at,id);
CREATE TABLE eats_store_assets (
  store_id TEXT NOT NULL REFERENCES eats_stores(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('logo','cover','menu_reference')),
  photo_id TEXT NOT NULL UNIQUE REFERENCES eats_photos(id),
  PRIMARY KEY(store_id,purpose)
);
CREATE TABLE eats_photo_reviews (
  id INTEGER PRIMARY KEY,
  photo_id TEXT NOT NULL,
  store_id TEXT NOT NULL REFERENCES eats_stores(id),
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
