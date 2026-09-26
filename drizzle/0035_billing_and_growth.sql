CREATE TABLE IF NOT EXISTS "billing_subscriptions" (
  "org_id" text PRIMARY KEY NOT NULL,
  "stripe_customer_id" text NOT NULL,
  "stripe_subscription_id" text,
  "plan" text,
  "interval" text,
  "status" text,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "trial_end" timestamp with time zone,
  "amount_cents" integer,
  "currency" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_subscriptions_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
  CONSTRAINT "billing_subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promo_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "plan" text NOT NULL,
  "months" integer,
  "max_redemptions" integer,
  "redeem_by" timestamp with time zone,
  "note" text,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "disabled_at" timestamp with time zone,
  CONSTRAINT "promo_codes_code_unique" UNIQUE("code")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "access_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "plan" text NOT NULL,
  "kind" text NOT NULL,
  "starts_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ends_at" timestamp with time zone,
  "promo_code_id" uuid,
  "referral_rung" integer,
  "granted_by" text,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by" text,
  CONSTRAINT "access_grants_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE set null ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_grants_org_idx" ON "access_grants" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_grants_code_idx" ON "access_grants" USING btree ("promo_code_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "access_grants_org_code_uq" ON "access_grants" USING btree ("org_id","promo_code_id") WHERE promo_code_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "access_grants_org_rung_uq" ON "access_grants" USING btree ("org_id","referral_rung") WHERE referral_rung is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "access_grants_org_launch_uq" ON "access_grants" USING btree ("org_id") WHERE kind = 'launch';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trial_claims" (
  "user_id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "plan" text NOT NULL,
  "claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_pauses" (
  "connection_id" uuid PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "paused_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plan_pauses_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_pauses_org_idx" ON "plan_pauses" USING btree ("org_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tracking_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "label" text NOT NULL,
  "source" text NOT NULL,
  "medium" text NOT NULL,
  "campaign" text,
  "destination" text DEFAULT '/' NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "tracking_links_slug_unique" UNIQUE("slug")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "link_clicks" (
  "link_id" uuid NOT NULL,
  "day" date NOT NULL,
  "clicks" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "link_clicks_pk" PRIMARY KEY("link_id","day"),
  CONSTRAINT "link_clicks_link_id_tracking_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."tracking_links"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_acquisitions" (
  "org_id" text PRIMARY KEY NOT NULL,
  "link_id" uuid,
  "source" text NOT NULL,
  "medium" text NOT NULL,
  "campaign" text,
  "clicked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_acquisitions_link_id_tracking_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."tracking_links"("id") ON DELETE set null ON UPDATE no action
);
