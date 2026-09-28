CREATE TABLE account_kemmy_setup (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  started_at BIGINT,
  email_deferred_at BIGINT,
  experience TEXT CHECK(experience IN ('customer','driver','eats_seller')),
  notifications_choice TEXT CHECK(notifications_choice IN ('enabled','in_app','later')),
  safety_choice TEXT CHECK(safety_choice IN ('review','later')),
  dismissed_at BIGINT,
  completed_at BIGINT,
  updated_at BIGINT NOT NULL
);
