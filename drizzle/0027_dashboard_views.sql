CREATE TABLE IF NOT EXISTS "dashboard_views" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"pos" text COLLATE "C" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_views_org_idx" ON "dashboard_views" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "dashboard_groups" ADD COLUMN IF NOT EXISTS "view_id" text;--> statement-breakpoint
ALTER TABLE "dashboard_tile_placements" ADD COLUMN IF NOT EXISTS "view_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboard_groups" ADD CONSTRAINT "dashboard_groups_view_id_dashboard_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."dashboard_views"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboard_tile_placements" ADD CONSTRAINT "dashboard_tile_placements_view_id_dashboard_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."dashboard_views"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_groups_view_idx" ON "dashboard_groups" USING btree ("view_id");--> statement-breakpoint
ALTER TABLE "dashboard_tile_placements" DROP CONSTRAINT IF EXISTS "dashboard_tile_placements_pk";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_placements_key_uq" ON "dashboard_tile_placements" USING btree ("org_id","view_id","tile_key") NULLS NOT DISTINCT;
