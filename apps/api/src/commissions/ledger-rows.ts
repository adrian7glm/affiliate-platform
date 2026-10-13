import type { LedgerEntry } from '@ap/commission';
import type { commissionEntries } from '@ap/db';

export type EntryRow = typeof commissionEntries.$inferSelect;

export function toLedgerEntry(row: EntryRow): LedgerEntry {
  return {
    id: row.id,
    bookingId: row.bookingId,
    kind: row.kind,
    status: row.status,
    amountMinor: row.amountMinor,
    rateBps: row.rateBps,
    baseMinor: row.baseMinor,
  };
}
