ALTER TABLE "connections" ADD COLUMN "next_sweep_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "consecutive_no_op_sweeps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "webhook_healthy_at" timestamp with time zone;