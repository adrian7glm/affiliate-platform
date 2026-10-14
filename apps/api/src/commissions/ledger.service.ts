import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type NewLedgerEntry,
  commissionAtSale,
  isApprovable,
  periodKeyFor,
  periodRange,
  reversalFor,
} from '@ap/commission';
import type { EventOfType } from '@ap/contracts';
import {
  type Database,
  affiliates,
  bookings,
  commissionEntries,
  products,
  tenants,
  tickets,
} from '@ap/db';
import { and, asc, eq, gte, inArray, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { TenantsService } from '../common/tenants';
import { DB, type DbOrTx, type Tx } from '../database/database.module';
import { Outbox } from '../outbox/outbox';
import { CommissionPlansService } from './commission-plans.service';
import { type EntryRow, toLedgerEntry } from './ledger-rows';

/** Pending entries looked at per round by the approval job. */
const APPROVAL_BATCH = 1000;

/**
 * The commission ledger: a `sale` entry when a booking is paid, a reversal when it is cancelled,
 * and approval once the trip happened. Entries are only ever added, never edited or deleted
 * (enforced by the database, see migration 0001).
 */
@Injectable()
export class CommissionLedgerService implements OnModuleInit {
  private readonly logger = new Logger('Commissions');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
    private readonly tenants: TenantsService,
    private readonly outbox: Outbox,
    private readonly plans: CommissionPlansService,
  ) {}

  onModuleInit(): void {
    this.outbox.on('booking.confirmed', 'commissions.record-sale', (event, tx) =>
      this.recordSale(event, tx),
    );
    this.outbox.on('booking.cancelled', 'commissions.reverse', (event, tx) =>
      this.reverse(event, tx),
    );
    this.outbox.on('ticket.checked_in', 'commissions.approve-on-boarding', async (event, tx) => {
      await this.approveBooking(tx, event.bookingId);
    });
  }

  /** booking.confirmed: write the `sale` entry, computed with the sales count at that moment. */
  async recordSale(event: EventOfType<'booking.confirmed'>, tx: Tx): Promise<void> {
    if (!event.affiliateId) return;
    // Serialize sales of one affiliate so two simultaneous payments get sale #4 and #5, not #4 twice.
    await tx
      .select({ id: affiliates.id })
      .from(affiliates)
      .where(eq(affiliates.id, event.affiliateId))
      .for('update');
    const resolved = await this.plans.planFor(tx, event.affiliateId);
    if (!resolved) {
      this.logger.warn(
        `no commission plan for affiliate ${event.affiliateId}; booking ${event.bookingId} earns nothing`,
      );
      return;
    }
    const tenant = await this.tenants.get(event.tenantId, tx);
    const paidAt = new Date(event.paidAt);
    const periodKey = periodKeyFor(paidAt, tenant.timezone);
    const { start } = periodRange(periodKey, tenant.timezone);

    const [before] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(bookings)
      .where(
        and(
          eq(bookings.affiliateId, event.affiliateId),
          eq(bookings.status, 'confirmed'),
          gte(bookings.paidAt, start),
          or(
            lt(bookings.paidAt, paidAt),
            and(eq(bookings.paidAt, paidAt), lt(bookings.id, event.bookingId)),
          ),
        ),
      );
    // A trip with its own rate pays it to every affiliate, except one with a negotiated rate:
    // what was agreed with them personally applies to every trip.
    const [trip] = await tx
      .select({
        rateBps: products.commissionRateBps,
        grossMinor: bookings.commissionGrossMinor,
        taxMinor: bookings.commissionTaxMinor,
      })
      .from(bookings)
      .innerJoin(products, eq(products.id, bookings.productId))
      .where(eq(bookings.id, event.bookingId));
    const tripRateBps = resolved.negotiated ? null : (trip?.rateBps ?? null);
    const commission = commissionAtSale(
      resolved.plan,
      {
        bookingId: event.bookingId,
        // Extras without commission are left out of the base; older bookings: the whole total.
        grossMinor: trip?.grossMinor ?? event.totalMinor,
        taxMinor: trip?.taxMinor ?? event.taxMinor,
        tripRateBps,
      },
      before?.count ?? 0,
    );
    await tx
      .insert(commissionEntries)
      .values({
        tenantId: event.tenantId,
        affiliateId: event.affiliateId,
        bookingId: event.bookingId,
        periodKey,
        kind: 'sale',
        amountMinor: commission.amountMinor,
        rateBps: commission.rateBps,
        baseMinor: commission.baseMinor,
        currency: event.currency,
        reason: `sale #${commission.saleNumber} of ${periodKey} (${tripRateBps !== null ? 'trip rate' : resolved.source})`,
        planSnapshot: resolved.plan,
        tripRateBps,
        createdAt: paidAt,
      })
      .onConflictDoNothing();
  }

  /** booking.cancelled: cancel what was earned. Pending entries are approved together with
   *  their reversal so they net out to zero in the next payout. */
  async reverse(event: EventOfType<'booking.cancelled'>, tx: Tx): Promise<void> {
    if (!event.affiliateId) return;
    const rows = await tx
      .select()
      .from(commissionEntries)
      .where(eq(commissionEntries.bookingId, event.bookingId));
    const reversal = reversalFor(
      rows.map(toLedgerEntry),
      event.bookingId,
      `booking cancelled: ${event.reason}`,
    );
    if (!reversal) return;
    const now = this.clock.now();
    const first = rows[0]!;
    await tx
      .update(commissionEntries)
      .set({ status: 'approved', approvedAt: now })
      .where(
        and(
          eq(commissionEntries.bookingId, event.bookingId),
          eq(commissionEntries.status, 'pending'),
        ),
      );
    await this.insertEntries(tx, first, [reversal], 'approved');
  }

  async insertEntries(
    tx: DbOrTx,
    template: EntryRow,
    entries: NewLedgerEntry[],
    status: 'pending' | 'approved',
  ): Promise<void> {
    if (entries.length === 0) return;
    const now = this.clock.now();
    await tx.insert(commissionEntries).values(
      entries.map((entry) => ({
        tenantId: template.tenantId,
        affiliateId: template.affiliateId,
        bookingId: entry.bookingId,
        periodKey: template.periodKey,
        kind: entry.kind,
        status: entry.amountMinor < 0 ? ('approved' as const) : status,
        approvedAt: entry.amountMinor < 0 || status === 'approved' ? now : null,
        amountMinor: entry.amountMinor,
        rateBps: entry.rateBps,
        baseMinor: entry.baseMinor,
        currency: template.currency,
        reason: entry.reason,
        planSnapshot: template.planSnapshot,
        createdAt: now,
      })),
    );
  }

  /** Approves the pending entries of a booking whose trip happened (ticket scanned). */
  async approveBooking(tx: DbOrTx, bookingId: string): Promise<number> {
    const rows = await tx
      .update(commissionEntries)
      .set({ status: 'approved', approvedAt: this.clock.now() })
      .where(
        and(eq(commissionEntries.bookingId, bookingId), eq(commissionEntries.status, 'pending')),
      )
      .returning({ id: commissionEntries.id });
    return rows.length;
  }

  /**
   * Approves pending entries whose trip happened: boarded, or the departure plus the operator's
   * grace period is past (scheduled job, and at month close). Due entries are selected in the
   * database, oldest first, so pending entries for future trips never hide the due ones.
   */
  async approveDue(tenantId?: string): Promise<number> {
    const now = this.clock.now();
    let approved = 0;
    for (;;) {
      const rows = await this.db
        .select({
          entry: commissionEntries,
          bookingStatus: bookings.status,
          startsAt: bookings.startsAt,
          checkedInAt: tickets.checkedInAt,
          graceHours: tenants.approvalGraceHours,
        })
        .from(commissionEntries)
        .innerJoin(bookings, eq(bookings.id, commissionEntries.bookingId))
        .innerJoin(tenants, eq(tenants.id, commissionEntries.tenantId))
        .leftJoin(tickets, eq(tickets.bookingId, bookings.id))
        .where(
          and(
            eq(commissionEntries.status, 'pending'),
            tenantId ? eq(commissionEntries.tenantId, tenantId) : undefined,
            // The same rules as isApprovable (@ap/commission), so only due entries are read.
            or(
              eq(commissionEntries.kind, 'reversal'),
              lt(commissionEntries.amountMinor, 0),
              and(
                eq(bookings.status, 'confirmed'),
                or(
                  isNotNull(tickets.checkedInAt),
                  lte(
                    bookings.startsAt,
                    sql`${now}::timestamptz - make_interval(hours => ${tenants.approvalGraceHours})`,
                  ),
                ),
              ),
            ),
          ),
        )
        .orderBy(asc(bookings.startsAt), asc(commissionEntries.id))
        .limit(APPROVAL_BATCH);
      const due = rows.filter((row) =>
        isApprovable(
          row.entry,
          {
            cancelled: row.bookingStatus !== 'confirmed',
            startsAt: row.startsAt,
            checkedInAt: row.checkedInAt,
          },
          now,
          row.graceHours,
        ),
      );
      if (due.length === 0) break;
      const updated = await this.db
        .update(commissionEntries)
        .set({ status: 'approved', approvedAt: now })
        .where(
          and(
            inArray(
              commissionEntries.id,
              due.map((r) => r.entry.id),
            ),
            eq(commissionEntries.status, 'pending'),
          ),
        )
        .returning({ id: commissionEntries.id });
      approved += updated.length;
      // Fewer rows than a full batch: nothing due is left.
      if (rows.length < APPROVAL_BATCH || updated.length === 0) break;
    }
    return approved;
  }
}
