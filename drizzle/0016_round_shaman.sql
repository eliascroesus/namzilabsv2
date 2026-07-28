CREATE TABLE "connection_archive" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"source" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stream_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"raw_event_count" integer DEFAULT 0 NOT NULL,
	"oldest_occurred_at" timestamp with time zone,
	"newest_occurred_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"purged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "connection_archive_conn_uq" ON "connection_archive" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "connection_archive_org_idx" ON "connection_archive" USING btree ("org_id");