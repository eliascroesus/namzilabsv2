-- 0030 — a person's display name and picture.
--
-- ADDITIVE AND SAFE TO RUN BEFORE THE DEPLOY. Nothing reads this table until
-- the profile page ships, and every reader treats a missing row as "no profile
-- set" — which is the state of every user the moment this runs. There is no
-- backfill, deliberately: a row appears the first time somebody changes
-- something, so the sign-in path never writes.
--
-- `avatar_url` holds a URL, never image bytes. The picture lives in blob
-- storage; this column is a short string on a table read on every page render.

CREATE TABLE IF NOT EXISTS "user_profiles" (
  "user_id" text PRIMARY KEY NOT NULL,
  "display_name" text,
  "avatar_url" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
