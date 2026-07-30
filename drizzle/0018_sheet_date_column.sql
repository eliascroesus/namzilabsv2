ALTER TABLE "source_streams" ADD COLUMN "date_field" text;--> statement-breakpoint
ALTER TABLE "source_streams" ADD COLUMN "restamp_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_streams" ADD COLUMN "date_field_state" jsonb;