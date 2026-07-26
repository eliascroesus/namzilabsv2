ALTER TABLE "sync_state" ADD COLUMN "sync_lock_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "sync_lock_token" text;