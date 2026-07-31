ALTER TABLE "source_streams" ADD COLUMN "date_field_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "source_streams" SET "date_field_locked" = true WHERE "date_field" IS NOT NULL;
