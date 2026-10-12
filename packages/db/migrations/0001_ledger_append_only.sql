-- The commission ledger is append-only: entries can only move forward through
-- pending -> approved -> paid (and be attached to a payout). Amounts never change and
-- nothing is deleted; corrections are new entries.
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
--> statement-breakpoint
CREATE TRIGGER commission_entries_append_only
  BEFORE UPDATE OR DELETE ON commission_entries
  FOR EACH ROW EXECUTE FUNCTION commission_entries_guard();
