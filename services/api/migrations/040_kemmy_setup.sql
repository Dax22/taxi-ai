-- Kemmy account setup state is deterministic and shared across web and mobile.
CREATE TABLE account_kemmy_setup (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  started_at INTEGER,
  email_deferred_at INTEGER,
  experience TEXT CHECK(experience IN ('customer','driver','eats_seller')),
  notifications_choice TEXT CHECK(notifications_choice IN ('enabled','in_app','later')),
  safety_choice TEXT CHECK(safety_choice IN ('review','later')),
  dismissed_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
) STRICT;
