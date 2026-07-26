CREATE TABLE "usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"operation" text DEFAULT '*' NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"throttled" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "paused_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "paused_reason" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_ledger_bucket_uq" ON "usage_ledger" USING btree ("connection_id","operation","window_start");--> statement-breakpoint
CREATE INDEX "usage_ledger_org_idx" ON "usage_ledger" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "usage_ledger_window_idx" ON "usage_ledger" USING btree ("window_start");