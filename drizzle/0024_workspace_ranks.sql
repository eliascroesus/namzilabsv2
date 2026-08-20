CREATE TABLE "workspace_ranks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"all_permissions" boolean DEFAULT false NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"all_metrics" boolean DEFAULT false NOT NULL,
	"metric_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inherits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rank_assignments" (
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"rank_id" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rank_assignments_pk" PRIMARY KEY ("org_id","user_id")
);
--> statement-breakpoint
CREATE INDEX "workspace_ranks_org_idx" ON "workspace_ranks" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_ranks_org_name_uq" ON "workspace_ranks" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "rank_assignments_org_rank_idx" ON "rank_assignments" USING btree ("org_id","rank_id");
