CREATE TABLE IF NOT EXISTS "workspace_owners" (
  "org_id"     text PRIMARY KEY NOT NULL,
  "user_id"    text NOT NULL,
  "claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source"     text NOT NULL
);
