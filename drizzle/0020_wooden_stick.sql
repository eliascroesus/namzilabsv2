DROP INDEX "raw_events_conn_idx";--> statement-breakpoint
DROP INDEX "usage_ledger_org_idx";--> statement-breakpoint
CREATE INDEX "connections_due_sweep_idx" ON "connections" USING btree ("next_sweep_at") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "dead_letter_raw_event_idx" ON "dead_letter" USING btree ("raw_event_id");--> statement-breakpoint
CREATE INDEX "delivery_log_created_idx" ON "delivery_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "flow_results_status_idx" ON "flow_results" USING btree ("status");