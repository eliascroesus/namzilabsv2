CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text,
  "actor_id" text,
  "action" text NOT NULL,
  "target" text,
  "detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_org_at_idx" ON "audit_log" USING btree ("org_id","at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_actor_at_idx" ON "audit_log" USING btree ("actor_id","at" DESC);
