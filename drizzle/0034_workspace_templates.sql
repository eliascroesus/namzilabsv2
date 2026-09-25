CREATE TABLE IF NOT EXISTS "workspace_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "code" text NOT NULL,
  "created_by" text NOT NULL,
  "author_name" text,
  "name" text NOT NULL,
  "description" text,
  "snapshot" jsonb NOT NULL,
  "source_view_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_templates_code_unique" UNIQUE("code")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_templates_org_idx" ON "workspace_templates" USING btree ("org_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_template_uses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_id" text NOT NULL,
  "org_id" text NOT NULL,
  "user_id" text NOT NULL,
  "version" integer NOT NULL,
  "new_workspace" boolean NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_template_uses_template_id_workspace_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workspace_templates"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_template_uses_template_idx" ON "workspace_template_uses" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_template_uses_org_idx" ON "workspace_template_uses" USING btree ("org_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dashboard_notes" (
  "org_id" text NOT NULL,
  "target_kind" text NOT NULL,
  "target_id" text NOT NULL,
  "note" text,
  "apps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dashboard_notes_pk" PRIMARY KEY("org_id","target_kind","target_id")
);
