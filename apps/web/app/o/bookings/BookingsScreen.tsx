'use client';

import type { BookingDto, BookingStatus } from '@ap/contracts';
import { useMemo, useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { BookingItem } from '@/components/BookingItem';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Field, SelectField, TextareaField } from '@/components/Field';
import { IconDownload, IconX } from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { isApiError } from '@/lib/api';
import { downloadCsv, minorToCsvAmount, toCsv } from '@/lib/csv';
import { addDays, dateKeyInTz, formatDateTime, formatDayLong, todayKey } from '@/lib/dates';
import { operatorApi } from '@/lib/endpoints';
import { currencyDigits } from '@/lib/format';
import { pluralRo } from '@/lib/i18n';
import { BOOKING_CHANNEL, BOOKING_STATUS } from '@/lib/labels';
import { errorMessageRo, useApi } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';

type StatusFilter = 'all' | BookingStatus;

const CANCELLABLE: BookingStatus[] = ['pending_payment', 'confirmed'];

function matches(booking: BookingDto, query: string): boolean {
  if (!query) return true;
  const q = query.toLocaleLowerCase('ro');
  return [
    booking.customerName,
    booking.reference,
    booking.productName,
    booking.affiliateName ?? '',
    booking.externalRef ?? '',
  ]
    .join(' ')
    .toLocaleLowerCase('ro')
    .includes(q);
}

export function BookingsScreen() {
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
        (b) => (status === 'all' || b.status === status) && matches(b, query.trim()),
      ),
    [bookings.data, status, query],
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
      setRangeError('Data „până la” trebuie să fie după data „de la”.');
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
        'Referință',
        'Ref. sistem propriu',
        'Excursie',
        'Plecare',
        'Locuri',
        'Client',
        'Total',
        'Monedă',
        'Plată',
        'Status',
        'Canal',
        'Afiliat',
        'Creată',
      ],
      visible.map((b) => [
        b.reference,
        b.externalRef,
        b.productName,
        formatDateTime(b.startsAt, tenant.timezone),
        b.seats,
        b.customerName,
        minorToCsvAmount(b.totalMinor, digits),
        b.currency,
        b.paymentMode === 'online' ? 'Online' : 'La îmbarcare',
        BOOKING_STATUS[b.status].label,
        BOOKING_CHANNEL[b.channel],
        b.affiliateName,
        formatDateTime(b.createdAt, tenant.timezone),
      ]),
    );
    downloadCsv(`rezervari-${range.from}-${range.to}.csv`, csv);
  }

  const totalSeats = visible
    .filter((b) => b.status === 'confirmed')
    .reduce((sum, b) => sum + b.seats, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Rezervări"
        description="Rezervările după data excursiei. Rezervările neplătite care au expirat nu apar aici."
        actions={
          visible.length > 0 ? (
            <Button variant="secondary" icon={<IconDownload />} onClick={exportCsv}>
              Descarcă CSV
            </Button>
          ) : null
        }
      />

      <section
        aria-label="Filtre"
        className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-4"
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => preset(today, today)}>
            Azi
          </Button>
          <Button variant="secondary" onClick={() => preset(addDays(today, 1), addDays(today, 1))}>
            Mâine
          </Button>
          <Button variant="secondary" onClick={() => preset(today, addDays(today, 7))}>
            Următoarele 7 zile
          </Button>
          <Button variant="secondary" onClick={() => preset(addDays(today, -30), today)}>
            Ultimele 30 de zile
          </Button>
        </div>
        <form
          onSubmit={applyRange}
          noValidate
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <Field
            label="Excursii de la"
            type="date"
            name="from"
            value={draft.from}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
          />
          <Field
            label="până la"
            type="date"
            name="to"
            value={draft.to}
            min={draft.from}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
          />
          <Button type="submit">Arată</Button>
        </form>
        {rangeError ? <p className="text-sm font-medium text-danger-fg">{rangeError}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Caută"
            type="search"
            name="q"
            autoComplete="off"
            placeholder="Nume client, referință, afiliat"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <SelectField
            label="Status"
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <option value="all">Toate</option>
            {(Object.keys(BOOKING_STATUS) as BookingStatus[])
              .filter((s) => s !== 'expired')
              .map((s) => (
                <option key={s} value={s}>
                  {BOOKING_STATUS[s].label}
                </option>
              ))}
          </SelectField>
        </div>
      </section>

      {bookings.loading && !bookings.data ? <LoadingBlock label="Se încarcă rezervările…" /> : null}
      {bookings.error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={bookings.reload}>
              Încearcă din nou
            </Button>
          }
        >
          {errorMessageRo(bookings.error)}
        </Alert>
      ) : null}

      {bookings.data ? (
        <p className="text-muted" aria-live="polite">
          {pluralRo(visible.length, 'rezervare', 'rezervări')} ·{' '}
          {pluralRo(totalSeats, 'loc confirmat', 'locuri confirmate')}
        </p>
      ) : null}

      {bookings.data && visible.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 p-4 text-muted">
          Nicio rezervare pentru filtrele alese.
        </p>
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
              {formatDayLong(day)}
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
                        {BOOKING_CHANNEL[booking.channel]}
                        {booking.affiliateName ? ` · ${booking.affiliateName}` : ''} ·{' '}
                        {booking.paymentMode === 'online' ? 'Plată online' : 'Plată la îmbarcare'}
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
                          Anulează
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
        title="Anulezi rezervarea?"
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
      setReasonError('Scrie pe scurt motivul anulării.');
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
          ? 'Sistemul tău de rezervări sau plățile nu răspund. Rezervarea nu a fost anulată; încearcă din nou.'
          : errorMessageRo(err),
      );
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-surface-2 p-3 text-sm">
        <div className="col-span-2">
          <dt className="text-muted">Excursie</dt>
          <dd className="font-semibold">
            {booking.productName}, {formatDateTime(booking.startsAt, timezone)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Locuri</dt>
          <dd className="font-semibold">{booking.seats}</dd>
        </div>
        <div>
          <dt className="text-muted">Total</dt>
          <dd className="font-semibold">
            <MoneyText amountMinor={booking.totalMinor} currency={booking.currency} />
          </dd>
        </div>
      </dl>
      {paid ? (
        <Alert tone="warning">
          Clientul a plătit online: suma se returnează automat pe cardul lui.
        </Alert>
      ) : null}
      <TextareaField
        label="Motivul anulării"
        name="reason"
        maxLength={400}
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={reasonError}
        placeholder="ex. Vreme rea, excursia nu mai pleacă"
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Renunță
        </Button>
        <Button type="submit" variant="danger" loading={busy} loadingText="Se anulează…">
          Anulează rezervarea
        </Button>
      </div>
    </form>
  );
}
