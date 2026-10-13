-- Structure review fixes: indexes for the hot queries, outbox retry backoff, worker heartbeats.
CREATE TABLE "worker_heartbeats" (
	"job" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "memberships_tenant" ON "memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "clicks_time" ON "clicks" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "bookings_tenant_paid" ON "bookings" USING btree ("tenant_id","paid_at");--> statement-breakpoint
CREATE INDEX "bookings_awaiting_payment" ON "bookings" USING btree ("hold_id") WHERE status = 'pending_payment';--> statement-breakpoint
CREATE INDEX "commission_entries_tenant_period" ON "commission_entries" USING btree ("tenant_id","period_key");--> statement-breakpoint
CREATE INDEX "commission_entries_pending" ON "commission_entries" USING btree ("booking_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "commission_entries_payable" ON "commission_entries" USING btree ("tenant_id","affiliate_id") WHERE status = 'approved' and payout_id is null;--> statement-breakpoint
CREATE INDEX "notifications_created" ON "notifications" USING btree ("created_at");