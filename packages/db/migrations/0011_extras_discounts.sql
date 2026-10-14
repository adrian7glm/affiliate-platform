CREATE TABLE "discount_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"percent_bps" integer,
	"amount_minor" integer,
	"affiliate_id" uuid,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valid_from" date,
	"valid_until" date,
	"max_uses" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_codes_one_kind" CHECK (("discount_codes"."percent_bps" is null) <> ("discount_codes"."amount_minor" is null)),
	CONSTRAINT "discount_codes_values" CHECK (("discount_codes"."percent_bps" is null or "discount_codes"."percent_bps" between 1 and 9000) and ("discount_codes"."amount_minor" is null or "discount_codes"."amount_minor" > 0) and ("discount_codes"."max_uses" is null or "discount_codes"."max_uses" > 0))
);
--> statement-breakpoint
ALTER TABLE "product_prices" ADD COLUMN "kind" text DEFAULT 'ticket' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_prices" ADD COLUMN "commissionable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "discount_code_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "discount_code" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "discount_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "commission_gross_minor" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "commission_tax_minor" integer;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_affiliate_id_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."affiliates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_codes_tenant_code" ON "discount_codes" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "discount_codes_affiliate" ON "discount_codes" USING btree ("affiliate_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_discount_code_id_discount_codes_id_fk" FOREIGN KEY ("discount_code_id") REFERENCES "public"."discount_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_discount_code" ON "bookings" USING btree ("discount_code_id");--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_kind" CHECK ("product_prices"."kind" in ('ticket', 'extra'));