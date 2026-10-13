ALTER TABLE "tenants" ADD COLUMN "review_url" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "remind_customers" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ask_for_reviews" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "notify_affiliates" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "monthly_report" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "affiliates" ADD COLUMN "notify_sales" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" ADD COLUMN "past_due_since" timestamp with time zone;