CREATE TABLE IF NOT EXISTS "dashboard_tiles" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"view_id" text NOT NULL,
	"tile_key" text NOT NULL,
	"chart" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"w" integer NOT NULL,
	"h" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dashboard_views" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'groups' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboard_tiles" ADD CONSTRAINT "dashboard_tiles_view_id_dashboard_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."dashboard_views"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_tiles_view_idx" ON "dashboard_tiles" USING btree ("org_id","view_id");
