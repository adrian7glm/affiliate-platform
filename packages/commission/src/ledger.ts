import type { SaleCommission } from './engine';

/**
 * The commission ledger is append-only. An entry is never edited or deleted: a correction is
 * a new entry. The amount an affiliate earned on a booking is the sum of all its entries.
 *
 * - `sale`: written when the booking is paid.
 * - `adjustment`: written when a period is reconciled (retroactive uplift, re-tiering after a
 *   cancellation earlier in the month).
 * - `reversal`: written when the booking is cancelled or refunded; cancels what was earned.
 */
export type EntryKind = 'sale' | 'adjustment' | 'reversal';

/**
 * - `pending`: earned but the trip has not happened yet (it can still be cancelled).
 * - `approved`: the trip happened (ticket scanned or start time passed); ready for payout.
 * - `paid`: included in a payout.
 */
export type EntryStatus = 'pending' | 'approved' | 'paid';

export interface LedgerEntry {
  id: string;
  bookingId: string;
  kind: EntryKind;
  status: EntryStatus;
  amountMinor: number;
  rateBps: number;
  baseMinor: number;
}

export interface NewLedgerEntry {
  bookingId: string;
  kind: EntryKind;
  amountMinor: number;
  rateBps: number;
  baseMinor: number;
  reason: string;
}

export function earnedOnBooking(entries: LedgerEntry[], bookingId: string): number {
  return entries
    .filter((entry) => entry.bookingId === bookingId)
    .reduce((sum, entry) => sum + entry.amountMinor, 0);
}

/** Entry that cancels everything earned so far on a booking. Null when nothing is left. */
export function reversalFor(
  entries: LedgerEntry[],
  bookingId: string,
  reason: string,
): NewLedgerEntry | null {
  const earned = earnedOnBooking(entries, bookingId);
  if (earned === 0) return null;
  const last = entries.filter((entry) => entry.bookingId === bookingId).at(-1);
  return {
    bookingId,
    kind: 'reversal',
    amountMinor: -earned,
    rateBps: last?.rateBps ?? 0,
    baseMinor: last?.baseMinor ?? 0,
    reason,
  };
}

/**
 * Compares what each booking should earn (from computePeriodCommissions) with what the ledger
 * holds, and returns the adjustment entries that close the gap.
 */
export function reconcile(expected: SaleCommission[], entries: LedgerEntry[]): NewLedgerEntry[] {
  // Summed once: looking every booking up in the whole ledger is quadratic on busy months.
  const earned = new Map<string, number>();
  for (const entry of entries) {
    earned.set(entry.bookingId, (earned.get(entry.bookingId) ?? 0) + entry.amountMinor);
  }
  const adjustments: NewLedgerEntry[] = [];
  for (const target of expected) {
    const delta = target.amountMinor - (earned.get(target.bookingId) ?? 0);
    if (delta === 0) continue;
    adjustments.push({
      bookingId: target.bookingId,
      kind: 'adjustment',
      amountMinor: delta,
      rateBps: target.rateBps,
      baseMinor: target.baseMinor,
      reason:
        target.saleNumber === null
          ? 'booking cancelled'
          : `period reconciliation: sale #${target.saleNumber} at ${target.rateBps / 100}%`,
    });
  }
  return adjustments;
}

export interface BookingForApproval {
  cancelled: boolean;
  startsAt: Date;
  checkedInAt: Date | null;
}

/**
 * A pending entry becomes payable once the trip has happened: the ticket was scanned, or the
 * departure time plus a grace period has passed without a cancellation.
 * Reversals and negative adjustments are approved immediately so they net out of the next payout.
 */
export function isApprovable(
  entry: Pick<LedgerEntry, 'kind' | 'status' | 'amountMinor'>,
  booking: BookingForApproval,
  now: Date,
  graceHours = 24,
): boolean {
  if (entry.status !== 'pending') return false;
  if (entry.kind === 'reversal' || entry.amountMinor < 0) return true;
  if (booking.cancelled) return false;
  if (booking.checkedInAt) return true;
  return now.getTime() >= booking.startsAt.getTime() + graceHours * 3_600_000;
}

export interface PayoutStatement {
  entryIds: string[];
  totalMinor: number;
  /** True when clawbacks exceed earnings: nothing is paid and the entries stay for next time. */
  carryForward: boolean;
}

/** Builds a payout from an affiliate's approved, unpaid entries. */
export function buildPayout(entries: LedgerEntry[]): PayoutStatement {
  const payable = entries.filter((entry) => entry.status === 'approved');
  const totalMinor = payable.reduce((sum, entry) => sum + entry.amountMinor, 0);
  if (totalMinor <= 0) {
    return { entryIds: [], totalMinor, carryForward: payable.length > 0 };
  }
  return { entryIds: payable.map((entry) => entry.id), totalMinor, carryForward: false };
}
