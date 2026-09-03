-- 0031 — the AI-assistant connection (MCP): grants, bindings, a workspace
-- switch and an audit trail. Additive; nothing reads these until MCP_ENABLED=1.
CREATE TABLE IF NOT EXISTS "mcp_grants" (
  "user_id" text NOT NULL,
  "org_id" text NOT NULL,
  "source" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "mcp_grants_pk" PRIMARY KEY ("user_id", "org_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_grants_org_idx" ON "mcp_grants" USING btree ("org_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_bindings" (
  "binding_key" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "org_id" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_bindings_user_idx" ON "mcp_bindings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_bindings_expires_idx" ON "mcp_bindings" USING btree ("expires_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_settings" (
  "org_id" text PRIMARY KEY NOT NULL,
  "ai_assistants_enabled" boolean DEFAULT true NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "user_id" text NOT NULL,
  "client_id" text,
  "tool" text NOT NULL,
  "args_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "rows" integer DEFAULT 0 NOT NULL,
  "bytes" integer DEFAULT 0 NOT NULL,
  "duration_ms" integer DEFAULT 0 NOT NULL,
  "reveal_contacts" boolean DEFAULT false NOT NULL,
  "error" text,
  "at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_calls_org_at_idx" ON "mcp_calls" USING btree ("org_id", "at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_calls_user_at_idx" ON "mcp_calls" USING btree ("user_id", "at" DESC);
