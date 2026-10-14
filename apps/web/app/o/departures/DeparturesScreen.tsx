'use client';

import type { DeparturePassengersDto, DepartureSummaryDto, PassengerDto } from '@ap/contracts';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconPhone,
  IconPrinter,
} from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { downloadCsv, minorToCsvAmount, toCsv } from '@/lib/csv';
import {
  addDays,
  dateKeyInTz,
  formatDayLabel,
  formatDayLong,
  formatTime,
  todayKey,
} from '@/lib/dates';
import { operatorApi } from '@/lib/endpoints';
import { currencyDigits, formatMoney } from '@/lib/format';
import {
  answerLabel,
  answersText,
  itemsText,
  markBoarded,
  passengerMatches,
} from '@/lib/passengers';
import { errorMessage, useApi } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The boarding list: a day's departures across all trips, and for the chosen one who is on board,
 * what they answered at booking, what is left to collect, and who has boarded. Printable, and as
 * CSV for the crew or the port office.
 */
export function DeparturesScreen() {
  const i18n = useT();
  const { t, lang } = i18n;
  const { tenant } = useOperator();
  const router = useRouter();
  const pathname = usePathname() ?? '/o/departures';
  const params = useSearchParams();
  const today = todayKey(tenant.timezone);
  const asked = params.get('date');
  const date = asked && DATE_KEY.test(asked) ? asked : today;
  const slotId = params.get('slot');

  const day = useApi(`operator-departures:${tenant.id}:${date}`, (signal) =>
    operatorApi.departures(date, { signal }),
  );

  function go(next: { date?: string; slot?: string | null }) {
    const query = new URLSearchParams();
    const nextDate = next.date ?? date;
    if (nextDate !== today) query.set('date', nextDate);
    const nextSlot = next.slot === undefined ? slotId : next.slot;
    if (nextSlot) query.set('slot', nextSlot);
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }

  /** On a phone the list is below the departures: once it loads, bring it into view. */
  const scrollOnLoad = useRef(false);
  function showPassengers() {
    scrollOnLoad.current = !window.matchMedia('(min-width: 64rem)').matches;
  }

  const label = formatDayLabel(date, lang);
  const departures = day.data?.departures ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="no-print">
        <PageHeader
          title={t('operator.departures.title')}
          description={t('operator.departures.description')}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] print:block">
        <section aria-labelledby="departures-day" className="no-print flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => go({ date: addDays(date, -1), slot: null })}
              aria-label={t('operator.departures.previousDay')}
              className="inline-flex size-12 items-center justify-center rounded-xl text-brand hover:bg-brand-soft"
            >
              <IconChevronLeft />
            </button>
            <h2
              id="departures-day"
              className="text-center text-lg font-semibold"
              aria-live="polite"
            >
              {date === today ? `${t('operator.bookings.today')} · ` : ''}
              {label.weekday} {label.day}
            </h2>
            <button
              type="button"
              onClick={() => go({ date: addDays(date, 1), slot: null })}
              aria-label={t('operator.departures.nextDay')}
              className="inline-flex size-12 items-center justify-center rounded-xl text-brand hover:bg-brand-soft"
            >
              <IconChevronRight />
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field
              type="date"
              label={t('operator.departures.pickDay')}
              className="min-w-0 flex-1"
              value={date}
              onChange={(e) => {
                if (DATE_KEY.test(e.target.value)) go({ date: e.target.value, slot: null });
              }}
            />
            {date !== today ? (
              <Button variant="secondary" onClick={() => go({ date: today, slot: null })}>
                {t('operator.bookings.today')}
              </Button>
            ) : null}
          </div>

          {day.loading && !day.data ? <LoadingBlock /> : null}
          {day.error ? (
            <Alert
              tone="error"
              action={
                <Button variant="secondary" onClick={day.reload}>
                  {t('common.retry')}
                </Button>
              }
            >
              {errorMessage(day.error, i18n)}
            </Alert>
          ) : null}
          {day.data && departures.length === 0 ? (
            <p className="rounded-2xl bg-surface-2 p-3 text-muted">
              {t('operator.departures.none', { day: formatDayLong(date, lang) })}
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {departures.map((d) => (
              <li key={d.slotId}>
                <DepartureButton
                  departure={d}
                  timezone={day.data?.timezone ?? tenant.timezone}
                  selected={d.slotId === slotId}
                  onSelect={() => {
                    go({ slot: d.slotId });
                    showPassengers();
                  }}
                />
              </li>
            ))}
          </ul>
        </section>

        <section
          id="passengers"
          aria-label={t('operator.departures.passengersTitle')}
          className="scroll-mt-20"
        >
          {slotId ? (
            <PassengerList
              key={slotId}
              slotId={slotId}
              onBoarded={() => day.reload()}
              onLoaded={() => {
                if (!scrollOnLoad.current) return;
                scrollOnLoad.current = false;
                document
                  .getElementById('passengers')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />
          ) : departures.length > 0 ? (
            <p className="no-print rounded-2xl bg-surface-2 p-4 text-muted">
              {t('operator.departures.chooseDeparture')}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function DepartureButton({
  departure: d,
  timezone,
  selected,
  onSelect,
}: {
  departure: DepartureSummaryDto;
  timezone: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t, tp, lang } = useT();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`flex w-full flex-col gap-1 rounded-2xl border-2 p-3 text-left ${
        selected ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:bg-surface-2'
      }`}
    >
      <span className="flex w-full flex-wrap items-baseline justify-between gap-2">
        <span className="text-lg font-bold tabular-nums">
          {formatTime(d.startsAt, timezone, lang)}
        </span>
        <span className="text-sm text-muted">
          {t('operator.departures.seatsOf', { booked: d.seatsBooked, capacity: d.capacity })}
        </span>
      </span>
      <span className="font-semibold">{d.productName}</span>
      <span className="flex flex-wrap gap-1.5">
        {d.seatsBooked > 0 ? (
          <StatusChip tone={d.seatsBoarded >= d.seatsBooked ? 'success' : 'neutral'}>
            {t('operator.departures.boardedOf', { boarded: d.seatsBoarded, booked: d.seatsBooked })}
          </StatusChip>
        ) : null}
        {d.pendingPayment > 0 ? (
          <StatusChip tone="warning">
            {tp('operator.departures.pendingPayment', d.pendingPayment)}
          </StatusChip>
        ) : null}
        {d.closed ? <StatusChip>{t('operator.departures.closed')}</StatusChip> : null}
      </span>
    </button>
  );
}

function PassengerList({
  slotId,
  onBoarded,
  onLoaded,
}: {
  slotId: string;
  onBoarded: () => void;
  onLoaded: () => void;
}) {
  const i18n = useT();
  const { t, tp, lang, locale } = i18n;
  const { tenant } = useOperator();
  const list = useApi(`operator-passengers:${slotId}`, (signal) =>
    operatorApi.passengers(slotId, { signal }),
  );
  const [query, setQuery] = useState('');
  const [boarding, setBoarding] = useState<PassengerDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const visible = useMemo(
    () => (list.data?.passengers ?? []).filter((p) => passengerMatches(p, query, locale)),
    [list.data, query, locale],
  );
  const loaded = !!list.data;
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  useEffect(() => {
    if (loaded) onLoadedRef.current();
  }, [loaded]);

  if (list.loading && !list.data) return <LoadingBlock />;
  if (list.error || !list.data) {
    return (
      <Alert
        tone="error"
        action={
          <Button variant="secondary" onClick={list.reload}>
            {t('common.retry')}
          </Button>
        }
      >
        {errorMessage(list.error, i18n)}
      </Alert>
    );
  }
  const data = list.data;
  const { departure } = data;
  const time = formatTime(departure.startsAt, data.timezone, lang);
  const dayKey = dateKeyInTz(departure.startsAt, data.timezone);

  async function board(passenger: PassengerDto) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await operatorApi.board(passenger.bookingId);
      if (result.result === 'not_valid') {
        setError(result.message);
      } else {
        list.setData((prev) =>
          prev
            ? markBoarded(prev, passenger.bookingId, result.checkedInAt ?? new Date().toISOString())
            : prev,
        );
        setNotice(
          result.collectMinor > 0
            ? t('operator.departures.boardedCollect', {
                name: passenger.customerName,
                amount: formatMoney(result.collectMinor, passenger.currency, lang),
              })
            : result.result === 'already_checked_in'
              ? t('operator.departures.alreadyBoarded', { name: passenger.customerName })
              : t('operator.departures.boardedNotice', { name: passenger.customerName }),
        );
        onBoarded();
      }
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
      setBoarding(null);
    }
  }

  function exportCsv(passengers: DeparturePassengersDto['passengers']) {
    const csv = toCsv(
      [
        t('operator.departures.csvName'),
        t('operator.departures.csvReference'),
        t('operator.departures.csvSeats'),
        t('operator.departures.csvTickets'),
        t('operator.departures.csvRoom'),
        t('operator.departures.csvPhone'),
        t('operator.departures.csvAnswers'),
        t('operator.departures.csvDue'),
        t('operator.departures.csvCurrency'),
        t('operator.departures.csvAffiliate'),
        t('operator.departures.csvStatus'),
        t('operator.departures.csvBoarded'),
      ],
      passengers.map((p) => [
        p.customerName,
        p.reference,
        p.seats,
        itemsText(p.items),
        p.hotelRoom,
        p.customerPhone,
        answersText(p.answers),
        minorToCsvAmount(p.amountDueMinor, currencyDigits(p.currency)),
        p.currency,
        p.affiliateName,
        p.status === 'pending_payment'
          ? t('operator.departures.notPaid')
          : t('operator.departures.confirmed'),
        p.boardedAt ? formatTime(p.boardedAt, data.timezone, lang) : '',
      ]),
    );
    downloadCsv(
      t('operator.departures.csvFile', { date: dayKey, time: time.replace(/\D/g, '') }),
      csv,
    );
  }

  const toBoard = data.passengers.filter((p) => p.status === 'confirmed' && !p.boardedAt);

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold">
              {time} · {departure.productName}
            </h2>
            <p className="text-muted">
              {formatDayLong(dayKey, lang)} · {tenant.name}
            </p>
            <p className="mt-1 font-semibold">
              {t('operator.departures.boardedOf', {
                boarded: departure.seatsBoarded,
                booked: departure.seatsBooked,
              })}
              {' · '}
              {t('operator.departures.seatsOf', {
                booked: departure.seatsBooked,
                capacity: departure.capacity,
              })}
            </p>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            <Button variant="secondary" icon={<IconPrinter />} onClick={() => window.print()}>
              {t('common.print')}
            </Button>
            <Button
              variant="secondary"
              icon={<IconDownload />}
              onClick={() => exportCsv(data.passengers)}
              disabled={data.passengers.length === 0}
            >
              {t('operator.departures.downloadCsv')}
            </Button>
          </div>
        </div>

        {notice ? (
          <div className="no-print" role="status">
            <Alert tone="success">{notice}</Alert>
          </div>
        ) : null}
        {error ? (
          <div className="no-print">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}

        {data.passengers.length === 0 ? (
          <p className="rounded-2xl bg-surface-2 p-3 text-muted">
            {t('operator.departures.noPassengers')}
          </p>
        ) : (
          <>
            {data.passengers.length > 6 ? (
              <Field
                className="no-print"
                type="search"
                label={t('operator.departures.search')}
                hint={t('operator.departures.searchHint')}
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            ) : null}
            <p className="no-print text-sm text-muted" aria-live="polite">
              {tp('operator.departures.toBoard', toBoard.length)}
            </p>
            <ul className="flex flex-col divide-y divide-line">
              {visible.map((p) => (
                <PassengerRow
                  key={p.bookingId}
                  passenger={p}
                  timezone={data.timezone}
                  onBoard={() => setBoarding(p)}
                />
              ))}
            </ul>
            {visible.length === 0 ? (
              <p className="text-muted">{t('operator.departures.noMatch')}</p>
            ) : null}
          </>
        )}
      </div>

      <Dialog
        open={!!boarding}
        onClose={() => setBoarding(null)}
        title={t('operator.departures.boardTitle')}
      >
        {boarding ? (
          <div className="flex flex-col gap-4">
            <p>{t('operator.departures.boardBody', { name: boarding.customerName })}</p>
            {boarding.amountDueMinor > 0 ? (
              <Alert tone="warning">
                {t('operator.departures.collectFirst', {
                  amount: formatMoney(boarding.amountDueMinor, boarding.currency, lang),
                })}
              </Alert>
            ) : null}
            <p className="text-sm text-muted">{t('operator.departures.boardHint')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="secondary" onClick={() => setBoarding(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="success"
                icon={<IconCheck />}
                loading={busy}
                loadingText={t('common.saving')}
                onClick={() => void board(boarding)}
              >
                {t('operator.departures.confirmBoard')}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </Card>
  );
}

function PassengerRow({
  passenger: p,
  timezone,
  onBoard,
}: {
  passenger: PassengerDto;
  timezone: string;
  onBoard: () => void;
}) {
  const { t, tp, lang } = useT();
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 break-inside-avoid">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-semibold">{p.customerName}</p>
          <p className="text-sm text-muted">
            {tp('common.seats', p.seats)} · {itemsText(p.items)} · {p.reference}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {p.status === 'pending_payment' ? (
            <StatusChip tone="warning">{t('operator.departures.notPaid')}</StatusChip>
          ) : p.boardedAt ? (
            <StatusChip tone="success">
              {t('operator.departures.boardedAt', {
                time: formatTime(p.boardedAt, timezone, lang),
              })}
            </StatusChip>
          ) : null}
          {p.amountDueMinor > 0 ? (
            <StatusChip tone="warning">
              {t('operator.departures.due', {
                amount: formatMoney(p.amountDueMinor, p.currency, lang),
              })}
            </StatusChip>
          ) : null}
        </div>
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        {p.hotelRoom ? (
          <div className="flex gap-1.5">
            <dt className="text-muted">{t('operator.departures.room')}:</dt>
            <dd className="font-semibold">{p.hotelRoom}</dd>
          </div>
        ) : null}
        {p.affiliateName ? (
          <div className="flex gap-1.5">
            <dt className="text-muted">{t('operator.departures.soldBy')}:</dt>
            <dd>{p.affiliateName}</dd>
          </div>
        ) : null}
        {p.answers.map((a) => (
          <div key={a.questionId} className="flex gap-1.5 sm:col-span-2">
            <dt className="text-muted">{answerLabel(a.label)}</dt>
            <dd className="font-semibold">{a.value}</dd>
          </div>
        ))}
      </dl>
      <div className="no-print flex flex-wrap gap-2">
        {p.status === 'confirmed' && !p.boardedAt ? (
          <Button variant="secondary" icon={<IconCheck />} onClick={onBoard}>
            {t('operator.departures.board')}
          </Button>
        ) : null}
        {p.customerPhone ? (
          <a
            href={`tel:${p.customerPhone.replace(/[^\d+]/g, '')}`}
            className="inline-flex min-h-12 items-center gap-2 rounded-2xl px-3 font-semibold text-brand hover:bg-brand-soft"
          >
            <IconPhone />
            {p.customerPhone}
          </a>
        ) : null}
      </div>
    </li>
  );
}
