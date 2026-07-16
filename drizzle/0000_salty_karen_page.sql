CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"source" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"auth_type" text DEFAULT 'none' NOT NULL,
	"credentials_encrypted" text,
	"signing_secret_encrypted" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dead_letter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"raw_event_id" uuid,
	"error" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "delivery_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"raw_event_id" uuid,
	"status" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"subject" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"value" numeric,
	"currency" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_event_id" uuid
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"source" text NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"signature_valid" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"cursor" text,
	"channel_id" text,
	"channel_resource_id" text,
	"channel_expiry" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"secret_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connections_org_idx" ON "connections" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "connections_status_idx" ON "connections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dead_letter_conn_idx" ON "dead_letter" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "delivery_log_conn_idx" ON "delivery_log" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "delivery_log_status_idx" ON "delivery_log" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "events_event_id_uq" ON "events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "events_org_type_idx" ON "events" USING btree ("org_id","event_type");--> statement-breakpoint
CREATE INDEX "events_occurred_idx" ON "events" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_uq" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "raw_events_conn_idx" ON "raw_events" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_endpoints_slug_uq" ON "webhook_endpoints" USING btree ("slug");