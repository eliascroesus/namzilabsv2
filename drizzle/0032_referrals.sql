CREATE TABLE IF NOT EXISTS "referral_codes" (
  "code" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "referral_codes_user_id_unique" UNIQUE("user_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referrals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "referrer_user_id" text NOT NULL,
  "referred_user_id" text NOT NULL,
  "code" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "referrals_referred_user_id_unique" UNIQUE("referred_user_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referrals_referrer_idx" ON "referrals" USING btree ("referrer_user_id","created_at" DESC);
