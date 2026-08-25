CREATE TABLE IF NOT EXISTS "dashboard_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'grey' NOT NULL,
	"pos" text COLLATE "C" NOT NULL,
	"sort_key" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dashboard_tile_placements" (
	"org_id" text NOT NULL,
	"tile_key" text NOT NULL,
	"group_id" text,
	"pos" text COLLATE "C" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_tile_placements_pk" PRIMARY KEY("org_id","tile_key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboard_tile_placements" ADD CONSTRAINT "dashboard_tile_placements_group_id_dashboard_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."dashboard_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_groups_org_idx" ON "dashboard_groups" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_placements_group_idx" ON "dashboard_tile_placements" USING btree ("group_id");
