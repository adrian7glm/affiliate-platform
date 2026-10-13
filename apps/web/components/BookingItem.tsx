'use client';

import type { BookingDto } from '@ap/contracts';
import type { ReactNode } from 'react';
import { formatDateTime } from '@/lib/dates';
import { bookingStatus } from '@/lib/labels';
import { useT } from './I18nProvider';
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
  const i18n = useT();
  const { t, lang } = i18n;
  const status = bookingStatus(i18n, booking.status);
  const ref = showExternalRef ? booking.externalRef : null;
  return (
    <article className="flex flex-col gap-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{booking.productName}</h3>
          <p className="text-sm text-muted">
            <time dateTime={booking.startsAt}>
              {formatDateTime(booking.startsAt, timezone, lang)}
            </time>{' '}
            · {t('common.seats', { count: booking.seats })}
          </p>
        </div>
        <MoneyText
          amountMinor={booking.totalMinor}
          currency={booking.currency}
          lang={lang}
          className="font-semibold"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-sm">
          {booking.customerName} <span className="text-muted">· {booking.reference}</span>
          {ref ? (
            <span className="ml-1 text-xs text-muted">· {t('common.externalRef', { ref })}</span>
          ) : null}
        </span>
        <StatusChip tone={status.tone}>{status.label}</StatusChip>
      </div>
      {extra}
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </article>
  );
}
