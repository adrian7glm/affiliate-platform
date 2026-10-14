ALTER TABLE "products" ADD COLUMN "translations" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "customer_note" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "questions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "commission_rate_bps" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "answers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD COLUMN "trip_rate_bps" integer;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_commission_rate_bps" CHECK ("commission_rate_bps" IS NULL OR "commission_rate_bps" BETWEEN 0 AND 10000);--> statement-breakpoint
-- The trip rate frozen on a ledger entry is as immutable as its amount.
CREATE OR REPLACE FUNCTION commission_entries_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'commission_entries is append-only: delete is not allowed';
  END IF;

  IF NEW.id <> OLD.id
     OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.affiliate_id <> OLD.affiliate_id
     OR NEW.booking_id <> OLD.booking_id
     OR NEW.period_key <> OLD.period_key
     OR NEW.kind <> OLD.kind
     OR NEW.amount_minor <> OLD.amount_minor
     OR NEW.rate_bps <> OLD.rate_bps
     OR NEW.base_minor <> OLD.base_minor
     OR NEW.currency <> OLD.currency
     OR NEW.reason <> OLD.reason
     OR NEW.plan_snapshot::text <> OLD.plan_snapshot::text
     OR NEW.trip_rate_bps IS DISTINCT FROM OLD.trip_rate_bps
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'commission_entries is append-only: only status and payout fields may change';
  END IF;

  IF NOT (
    (OLD.status = NEW.status)
    OR (OLD.status = 'pending' AND NEW.status IN ('approved', 'paid'))
    OR (OLD.status = 'approved' AND NEW.status = 'paid')
  ) THEN
    RAISE EXCEPTION 'commission entry status cannot go from % to %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
