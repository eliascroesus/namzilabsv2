CREATE TABLE "source_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"config_hash" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cursor" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_polled_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "stream_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "source_streams_conn_cfg_uq" ON "source_streams" USING btree ("connection_id","config_hash");--> statement-breakpoint
CREATE INDEX "source_streams_org_idx" ON "source_streams" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "events_conn_stream_idx" ON "events" USING btree ("connection_id","stream_hash");