CREATE TABLE "backfill_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"stream_id" uuid NOT NULL,
	"stream_hash" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"target_floor" timestamp with time zone NOT NULL,
	"reached_floor" timestamp with time zone,
	"checkpoint" text,
	"rows_imported" integer DEFAULT 0 NOT NULL,
	"row_ceiling" integer NOT NULL,
	"detail" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_progress_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "backfill_jobs_stream_target_uq" ON "backfill_jobs" USING btree ("stream_id","target_floor");--> statement-breakpoint
CREATE INDEX "backfill_jobs_status_progress_idx" ON "backfill_jobs" USING btree ("status","last_progress_at");--> statement-breakpoint
CREATE INDEX "backfill_jobs_org_idx" ON "backfill_jobs" USING btree ("org_id");