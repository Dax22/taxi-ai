-- Preserve the selected first-use experience across Google authentication redirects.
ALTER TABLE google_auth_attempts ADD COLUMN signup_intent TEXT CHECK(signup_intent IS NULL OR signup_intent IN ('customer','driver','eats_seller'));
