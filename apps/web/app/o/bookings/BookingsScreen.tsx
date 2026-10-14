'use client';

import type { BookingDto, BookingStatus } from '@ap/contracts';
import { useMemo, useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { BookingItem } from '@/components/BookingItem';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Field, SelectField, TextareaField } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { IconDownload, IconX } from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { isApiError } from '@/lib/api';
import { downloadCsv, minorToCsvAmount, toCsv } from '@/lib/csv';
import { addDays, dateKeyInTz, formatDateTime, formatDayLong, todayKey } from '@/lib/dates';
import { operatorApi } from '@/lib/endpoints';
import { currencyDigits } from '@/lib/format';
import { bookingChannel, bookingStatus } from '@/lib/labels';
import { errorMessage, useApi } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';

type StatusFilter = 'all' | BookingStatus;

const CANCELLABLE: BookingStatus[] = ['pending_payment', 'confirmed'];

/** Statuses offered in the filter (expired bookings are not listed). */
const FILTER_STATUSES: BookingStatus[] = ['pending_payment', 'confirmed', 'cancelled', 'refunded'];

function matches(booking: BookingDto, query: string, locale: string): boolean {
  if (!query) return true;
  const q = query.toLocaleLowerCase(locale);
  return [
    booking.customerName,
    booking.reference,
    booking.productName,
    booking.affiliateName ?? '',
    booking.externalRef ?? '',
  ]
    .join(' ')
    .toLocaleLowerCase(locale)
    .includes(q);
}

export function BookingsScreen() {
  const tr = useT();
  const { t, tp, lang, locale } = tr;
  const { tenant } = useOperator();
  const today = todayKey(tenant.timezone);
  const [range, setRange] = useState({ from: today, to: addDays(today, 7) });
  const [draft, setDraft] = useState(range);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [cancelling, setCancelling] = useState<BookingDto | null>(null);

  const bookings = useApi(`operator-bookings:${tenant.id}:${range.from}:${range.to}`, (signal) =>
    operatorApi.bookings(range, { signal }),
  );

  const visible = useMemo(
    () =>
      (bookings.data ?? []).filter(
        (b) => (status === 'all' || b.status === status) && matches(b, query.trim(), locale),
      ),
    [bookings.data, status, query, locale],
  );

  const byDay = useMemo(() => {
    const groups = new Map<string, BookingDto[]>();
    for (const booking of visible) {
      const key = dateKeyInTz(booking.startsAt, tenant.timezone);
      const list = groups.get(key);
      if (list) list.push(booking);
      else groups.set(key, [booking]);
    }
    return [...groups.entries()];
  }, [visible, tenant.timezone]);

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.from || !draft.to || draft.to < draft.from) {
      setRangeError(t('operator.bookings.rangeError'));
      return;
    }
    setRangeError(null);
    setRange(draft);
  }

  function preset(from: string, to: string) {
    setRangeError(null);
    setDraft({ from, to });
    setRange({ from, to });
  }

  function exportCsv() {
    const digits = currencyDigits(tenant.currency);
    const csv = toCsv(
      [
        t('operator.bookings.csvReference'),
        t('operator.bookings.csvExternalRef'),
        t('operator.bookings.csvProduct'),
        t('operator.bookings.csvDeparture'),
        t('operator.bookings.csvSeats'),
        t('operator.bookings.csvCustomer'),
        t('operator.bookings.csvEmail'),
        t('operator.bookings.csvPhone'),
        t('operator.bookings.csvTotal'),
        t('operator.bookings.csvTax'),
        t('operator.bookings.csvCurrency'),
        t('operator.bookings.csvPayment'),
        t('operator.bookings.csvPaidAt'),
        t('operator.bookings.csvStatus'),
        t('operator.bookings.csvChannel'),
        t('operator.bookings.csvAffiliate'),
        t('operator.bookings.csvCreated'),
      ],
      visible.map((b) => [
        b.reference,
        b.externalRef,
        b.productName,
        formatDateTime(b.startsAt, tenant.timezone, lang),
        b.seats,
        b.customerName,
        b.customerEmail,
        b.customerPhone,
        minorToCsvAmount(b.totalMinor, digits),
        minorToCsvAmount(b.taxMinor, digits),
        b.currency,
        b.paymentMode === 'online'
          ? t('operator.bookings.paymentOnline')
          : t('operator.bookings.paymentOnBoard'),
        b.paidAt ? formatDateTime(b.paidAt, tenant.timezone, lang) : null,
        bookingStatus(tr, b.status).label,
        bookingChannel(tr, b.channel),
        b.affiliateName,
        formatDateTime(b.createdAt, tenant.timezone, lang),
      ]),
    );
    downloadCsv(t('operator.bookings.csvFile', { from: range.from, to: range.to }), csv);
  }

  const totalSeats = visible
    .filter((b) => b.status === 'confirmed')
    .reduce((sum, b) => sum + b.seats, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('operator.bookings.title')}
        description={t('operator.bookings.description')}
        actions={
          visible.length > 0 ? (
            <Button variant="secondary" icon={<IconDownload />} onClick={exportCsv}>
              {t('operator.bookings.downloadCsv')}
            </Button>
          ) : null
        }
      />

      <section
        aria-label={t('operator.bookings.filters')}
        className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-4"
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => preset(today, today)}>
            {t('operator.bookings.today')}
          </Button>
          <Button variant="secondary" onClick={() => preset(addDays(today, 1), addDays(today, 1))}>
            {t('operator.bookings.tomorrow')}
          </Button>
          <Button variant="secondary" onClick={() => preset(today, addDays(today, 7))}>
            {t('operator.bookings.next7')}
          </Button>
          <Button variant="secondary" onClick={() => preset(addDays(today, -30), today)}>
            {t('operator.bookings.last30')}
          </Button>
        </div>
        <form
          onSubmit={applyRange}
          noValidate
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <Field
            label={t('operator.bookings.from')}
            type="date"
            name="from"
            value={draft.from}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
          />
          <Field
            label={t('operator.bookings.to')}
            type="date"
            name="to"
            value={draft.to}
            min={draft.from}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
          />
          <Button type="submit">{t('operator.bookings.show')}</Button>
        </form>
        {rangeError ? <p className="text-sm font-medium text-danger-fg">{rangeError}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('operator.bookings.search')}
            type="search"
            name="q"
            autoComplete="off"
            placeholder={t('operator.bookings.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <SelectField
            label={t('operator.bookings.status')}
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <option value="all">{t('operator.bookings.all')}</option>
            {FILTER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {bookingStatus(tr, s).label}
              </option>
            ))}
          </SelectField>
        </div>
      </section>

      {bookings.loading && !bookings.data ? (
        <LoadingBlock label={t('operator.bookings.loading')} />
      ) : null}
      {bookings.error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={bookings.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(bookings.error, tr)}
        </Alert>
      ) : null}

      {bookings.data ? (
        <p className="text-muted" aria-live="polite">
          {tp('operator.bookings.count', visible.length)} ·{' '}
          {tp('operator.bookings.confirmedSeats', totalSeats)}
        </p>
      ) : null}

      {bookings.data && visible.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 p-4 text-muted">{t('operator.bookings.empty')}</p>
      ) : null}

      <div className="flex flex-col gap-5">
        {byDay.map(([day, list]) => (
          <section
            key={day}
            aria-labelledby={`day-${day}`}
            className="rounded-3xl border border-line bg-surface px-4 sm:px-5"
          >
            <h2
              id={`day-${day}`}
              className="border-b border-line py-3 text-lg font-semibold first-letter:uppercase"
            >
              {formatDayLong(day, lang)}
            </h2>
            <ul className="divide-y divide-line">
              {list.map((booking) => (
                <li key={booking.id}>
                  <BookingItem
                    booking={booking}
                    timezone={tenant.timezone}
                    showExternalRef
                    extra={
                      <p className="text-sm text-muted">
                        {bookingChannel(tr, booking.channel)}
                        {booking.affiliateName ? ` · ${booking.affiliateName}` : ''} ·{' '}
                        {booking.paymentMode === 'online'
                          ? t('operator.bookings.paidOnline')
                          : t('operator.bookings.payOnBoard')}
                      </p>
                    }
                    actions={
                      CANCELLABLE.includes(booking.status) ? (
                        <Button
                          variant="ghost"
                          icon={<IconX />}
                          onClick={() => setCancelling(booking)}
                          className="-ml-3"
                        >
                          {t('operator.bookings.cancel')}
                        </Button>
                      ) : null
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <Dialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title={t('operator.bookings.cancelTitle')}
        description={
          cancelling ? `${cancelling.reference} · ${cancelling.customerName}` : undefined
        }
      >
        {cancelling ? (
          <CancelForm
            key={cancelling.id}
            booking={cancelling}
            timezone={tenant.timezone}
            onDone={(updated) => {
              bookings.setData((prev) =>
                (prev ?? []).map((b) => (b.id === updated.id ? updated : b)),
              );
              setCancelling(null);
            }}
            onCancel={() => setCancelling(null)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function CancelForm({
  booking,
  timezone,
  onDone,
  onCancel,
}: {
  booking: BookingDto;
  timezone: string;
  onDone: (booking: BookingDto) => void;
  onCancel: () => void;
}) {
  const tr = useT();
  const { t, lang } = tr;
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const paid =
    booking.status === 'confirmed' && booking.paidAt !== null && booking.paymentMode === 'online';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = reason.trim();
    if (!text) {
      setReasonError(t('operator.bookings.reasonRequired'));
      return;
    }
    setReasonError(null);
    setBusy(true);
    setError(null);
    try {
      onDone(await operatorApi.cancelBooking(booking.id, { reason: text }));
    } catch (err) {
      setError(
        isApiError(err) && err.status === 502
          ? t('operator.bookings.providerDown')
          : errorMessage(err, tr),
      );
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-surface-2 p-3 text-sm">
        <div className="col-span-2">
          <dt className="text-muted">{t('operator.bookings.trip')}</dt>
          <dd className="font-semibold">
            {booking.productName}, {formatDateTime(booking.startsAt, timezone, lang)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t('operator.bookings.seats')}</dt>
          <dd className="font-semibold">{booking.seats}</dd>
        </div>
        <div>
          <dt className="text-muted">{t('operator.bookings.total')}</dt>
          <dd className="font-semibold">
            <MoneyText amountMinor={booking.totalMinor} currency={booking.currency} />
          </dd>
        </div>
      </dl>
      {paid ? <Alert tone="warning">{t('operator.bookings.refundNotice')}</Alert> : null}
      <TextareaField
        label={t('operator.bookings.reason')}
        name="reason"
        maxLength={400}
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={reasonError}
        placeholder={t('operator.bookings.reasonPlaceholder')}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          {t('operator.bookings.keep')}
        </Button>
        <Button
          type="submit"
          variant="danger"
          loading={busy}
          loadingText={t('operator.bookings.cancelling')}
        >
          {t('operator.bookings.confirmCancel')}
        </Button>
      </div>
    </form>
  );
}
