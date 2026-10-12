CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled');--> statement-breakpoint
CREATE TABLE "operator_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"business_name" text NOT NULL,
	"plan_id" uuid,
	"fee_bps_override" integer,
	"trial_days" integer,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"tenant_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "platform_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"monthly_price_minor" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"platform_fee_bps" integer NOT NULL,
	"trial_days" integer DEFAULT 14 NOT NULL,
	"max_affiliates" integer,
	"stripe_price_id" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "tenant_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"fee_bps_override" integer,
	"price_minor_override" integer,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_subscriptions_tenant_id_unique" UNIQUE("tenant_id"),
	CONSTRAINT "tenant_subscriptions_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "tenant_subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "status" "tenant_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "operator_invites" ADD CONSTRAINT "operator_invites_plan_id_platform_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."platform_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_invites" ADD CONSTRAINT "operator_invites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_invites" ADD CONSTRAINT "operator_invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_plan_id_platform_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."platform_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_invites_email" ON "operator_invites" USING btree ("email");--> statement-breakpoint
-- Starting plans; the platform owner edits prices and fees in the admin area.
INSERT INTO "platform_plans" ("code", "name", "description", "monthly_price_minor", "currency", "platform_fee_bps", "trial_days", "max_affiliates", "is_default", "sort_order")
VALUES
  ('start', 'Start', 'Pentru operatori mici: până la 15 afiliați.', 1900, 'EUR', 300, 14, 15, true, 1),
  ('pro', 'Pro', 'Afiliați nelimitați și comision de platformă redus.', 4900, 'EUR', 200, 14, NULL, false, 2);
--> statement-breakpoint
-- Operators that existed before billing keep their current fee and start a trial on the default plan.
INSERT INTO "tenant_subscriptions" ("tenant_id", "plan_id", "status", "trial_ends_at", "fee_bps_override")
SELECT t."id", p."id", 'trialing', now() + interval '14 days', t."platform_fee_bps"
FROM "tenants" t CROSS JOIN "platform_plans" p
WHERE p."code" = 'start';
