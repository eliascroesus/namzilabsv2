DROP INDEX "events_occurred_idx";--> statement-breakpoint
DROP INDEX "events_conn_idx";--> statement-breakpoint
DROP INDEX "events_conn_stream_idx";--> statement-breakpoint
CREATE INDEX "events_conn_stream_live_idx" ON "events" USING btree ("connection_id","stream_hash","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "events_org_live_occurred_idx" ON "events" USING btree ("org_id","occurred_at") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "events_conn_gen_live_idx" ON "events" USING btree ("connection_id","sync_generation") WHERE deleted_at is null;