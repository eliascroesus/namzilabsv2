CREATE TABLE "stream_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"stream_hash" text,
	"field_path" text NOT NULL,
	"inferred_type" text DEFAULT 'string' NOT NULL,
	"approx_cardinality" integer DEFAULT 0 NOT NULL,
	"seen_count" integer DEFAULT 0 NOT NULL,
	"sample" jsonb,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "identifiers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "stream_fields_key_uq" ON "stream_fields" USING btree ("connection_id","stream_hash","field_path");--> statement-breakpoint
CREATE INDEX "stream_fields_org_idx" ON "stream_fields" USING btree ("org_id");