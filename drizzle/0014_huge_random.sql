ALTER TABLE "connections" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "events_deleted_idx" ON "events" USING btree ("deleted_at") WHERE deleted_at is not null;--> statement-breakpoint
CREATE INDEX "raw_events_conn_received_idx" ON "raw_events" USING btree ("connection_id","received_at");