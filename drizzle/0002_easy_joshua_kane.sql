CREATE TABLE "flow_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"flow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"output_node_id" text NOT NULL,
	"tile" jsonb,
	"status" text DEFAULT 'stale' NOT NULL,
	"error" text,
	"computed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"version" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"draft_graph" jsonb DEFAULT '{"nodes":[],"edges":[]}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "sync_status" text DEFAULT 'synced' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "sync_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "historical_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "sync_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "flow_results" ADD CONSTRAINT "flow_results_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_versions" ADD CONSTRAINT "flow_versions_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flow_results_flow_output_uq" ON "flow_results" USING btree ("flow_id","output_node_id");--> statement-breakpoint
CREATE INDEX "flow_results_org_idx" ON "flow_results" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_versions_flow_version_uq" ON "flow_versions" USING btree ("flow_id","version");--> statement-breakpoint
CREATE INDEX "flow_versions_org_idx" ON "flow_versions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "flows_org_idx" ON "flows" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "events_conn_idx" ON "events" USING btree ("connection_id");