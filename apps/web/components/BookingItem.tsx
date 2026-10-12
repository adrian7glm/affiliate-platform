import type { BookingDto } from '@ap/contracts';
import type { ReactNode } from 'react';
import { externalRef } from '@/lib/contracts-ext';
import { formatDateTime } from '@/lib/dates';
import { pluralRo } from '@/lib/i18n';
import { BOOKING_STATUS } from '@/lib/labels';
import { MoneyText } from './MoneyText';
import { StatusChip } from './StatusChip';

/** One booking in a list: what, when, who, how much, status. */
export function BookingItem({
  booking,
  timezone,
  extra,
  actions,
  showExternalRef = false,
}: {
  booking: BookingDto;
  timezone?: string | null;
  extra?: ReactNode;
  actions?: ReactNode;
  /** Operator lists: show the booking's reference in the operator's own system. */
  showExternalRef?: boolean;
}) {
  const status = BOOKING_STATUS[booking.status];
  const ref = showExternalRef ? externalRef(booking) : null;
  return (
    <article className="flex flex-col gap-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{booking.productName}</h3>
          <p className="text-sm text-muted">
            <time dateTime={booking.startsAt}>{formatDateTime(booking.startsAt, timezone)}</time> ·{' '}
            {pluralRo(booking.seats, 'loc', 'locuri')}
          </p>
        </div>
        <MoneyText
          amountMinor={booking.totalMinor}
          currency={booking.currency}
          className="font-semibold"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-sm">
          {booking.customerName} <span className="text-muted">· {booking.reference}</span>
          {ref ? (
            <span className="ml-1 text-xs text-muted">· Ref. sistem propriu: {ref}</span>
          ) : null}
        </span>
        <StatusChip tone={status.tone}>{status.label}</StatusChip>
      </div>
      {extra}
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </article>
  );
}
