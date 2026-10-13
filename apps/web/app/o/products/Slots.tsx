'use client';

import type { CancelDeparturesBody, OperatorSlotDto, ProductDto } from '@ap/contracts';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { ChoiceGroup, Field, INPUT_CLASSES, TextareaField } from '@/components/Field';
import { IconChevronLeft, IconChevronRight, IconPlus, IconStorm, IconX } from '@/components/icons';
import { LoadingBlock } from '@/components/Spinner';
import { groupSlotsByDay } from '@/lib/booking';
import { addDays, formatDayLabel, formatDayLong, formatTime, todayKey } from '@/lib/dates';
import { operatorApi } from '@/lib/endpoints';
import { errorMessage, useApi } from '@/lib/useApi';
import { useT } from '@/components/I18nProvider';
import { useOperator } from '../OperatorContext';

/** ISO weekday (1 = Monday) and the key of its name in catalog.slots.weekdayShort/Long. */
const WEEKDAYS = [
  { value: 1, key: 'mon' },
  { value: 2, key: 'tue' },
  { value: 3, key: 'wed' },
  { value: 4, key: 'thu' },
  { value: 5, key: 'fri' },
  { value: 6, key: 'sat' },
  { value: 7, key: 'sun' },
] as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Generates departures (CreateSlotsBody): every chosen weekday in a date range, at each time. */
export function SlotsDialog({
  product,
  onCreated,
}: {
  product: ProductDto;
  onCreated: (created: number) => void;
}) {
  const { tenant } = useOperator();
  const i18n = useT();
  const { t, tk } = i18n;
  const today = todayKey(tenant.timezone);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(addDays(today, 30));
  const [times, setTimes] = useState<string[]>(['10:00', '14:00']);
  const [newTime, setNewTime] = useState('17:00');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [capacity, setCapacity] = useState('20');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function addTime() {
    if (!TIME_RE.test(newTime)) {
      setErrors((e) => ({ ...e, times: t('catalog.slots.errTime') }));
      return;
    }
    setTimes((prev) => (prev.includes(newTime) ? prev : [...prev, newTime].sort()));
    setErrors(({ times: _ignored, ...rest }) => rest);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!fromDate || !toDate || toDate < fromDate) next.dates = t('catalog.slots.errDates');
    if (times.length === 0) next.times = t('catalog.slots.errTimes');
    if (weekdays.length === 0) next.weekdays = t('catalog.slots.errWeekdays');
    const seats = Number(capacity);
    if (!Number.isInteger(seats) || seats < 1 || seats > 10000)
      next.capacity = t('catalog.slots.errCapacity');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      const result = await operatorApi.createSlots(product.id, {
        fromDate,
        toDate,
        times,
        weekdays,
        capacity: seats,
      });
      onCreated(result.created);
    } catch (err) {
      setError(errorMessage(err, i18n));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={t('catalog.slots.fromDate')}
          type="date"
          name="fromDate"
          required
          value={fromDate}
          min={today}
          onChange={(e) => setFromDate(e.target.value)}
        />
        <Field
          label={t('catalog.slots.toDate')}
          type="date"
          name="toDate"
          required
          value={toDate}
          min={fromDate}
          onChange={(e) => setToDate(e.target.value)}
        />
      </div>
      {errors.dates ? (
        <p className="-mt-2 text-sm font-medium text-danger-fg">{errors.dates}</p>
      ) : null}

      <fieldset className="min-w-0">
        <legend className="mb-1.5 font-semibold">{t('catalog.slots.timesLegend')}</legend>
        <ul className="mb-2 flex flex-wrap gap-2" aria-live="polite">
          {times.map((time) => (
            <li
              key={time}
              className="inline-flex items-center gap-1 rounded-full bg-brand-soft py-1 pl-3 pr-1 font-semibold text-brand-soft-fg"
            >
              {time}
              <button
                type="button"
                className="inline-flex size-10 items-center justify-center rounded-full hover:bg-surface"
                onClick={() => setTimes((prev) => prev.filter((x) => x !== time))}
                aria-label={t('catalog.slots.removeTime', { time })}
              >
                <IconX size={18} />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="visually-hidden">{t('catalog.slots.newTime')}</span>
            <input
              type="time"
              className={INPUT_CLASSES}
              value={newTime}
              step={300}
              onChange={(e) => setNewTime(e.target.value)}
            />
          </label>
          <Button variant="secondary" icon={<IconPlus />} onClick={addTime}>
            {t('catalog.slots.addTime')}
          </Button>
        </div>
        {errors.times ? (
          <p className="mt-1.5 text-sm font-medium text-danger-fg">{errors.times}</p>
        ) : null}
      </fieldset>

      <fieldset className="min-w-0">
        <legend className="mb-1.5 font-semibold">{t('catalog.slots.weekdaysLegend')}</legend>
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((day) => (
            <label key={day.value} className="choice">
              <input
                type="checkbox"
                checked={weekdays.includes(day.value)}
                onChange={(e) =>
                  setWeekdays((prev) =>
                    e.target.checked
                      ? [...prev, day.value].sort()
                      : prev.filter((d) => d !== day.value),
                  )
                }
              />
              <span
                className="choice-body items-center px-1 text-center font-semibold"
                aria-hidden="true"
              >
                {tk(`catalog.slots.weekdayShort.${day.key}`)}
              </span>
              <span className="visually-hidden">{tk(`catalog.slots.weekdayLong.${day.key}`)}</span>
            </label>
          ))}
        </div>
        {errors.weekdays ? (
          <p className="mt-1.5 text-sm font-medium text-danger-fg">{errors.weekdays}</p>
        ) : null}
      </fieldset>

      <Field
        label={t('catalog.slots.capacity')}
        name="capacity"
        inputMode="numeric"
        autoComplete="off"
        required
        value={capacity}
        onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ''))}
        error={errors.capacity}
      />

      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        type="submit"
        size="lg"
        block
        loading={busy}
        loadingText={t('catalog.slots.creating')}
      >
        {t('catalog.slots.create')}
      </Button>
    </form>
  );
}

const WINDOW_DAYS = 14;

/**
 * Departures of a trip, two weeks at a time, grouped by day. For the operator's own calendar
 * each departure can be resized, closed or deleted, and a whole day closed at once (bad weather).
 */
export function UpcomingSlots({ product }: { product: ProductDto }) {
  const { tenant } = useOperator();
  const i18n = useT();
  const { t, tp, lang } = i18n;
  const today = todayKey(tenant.timezone);
  const [offset, setOffset] = useState(0);
  const from = addDays(today, offset);
  const to = addDays(from, WINDOW_DAYS - 1);
  const slots = useApi(`operator-slots:${product.id}:${from}`, (signal) =>
    operatorApi.slots(product.id, { from, to }, { signal }),
  );
  const [editing, setEditing] = useState<OperatorSlotDto | null>(null);
  const [closingDay, setClosingDay] = useState<{ day: string; list: OperatorSlotDto[] } | null>(
    null,
  );
  const [cancelling, setCancelling] = useState<{ title: string; list: OperatorSlotDto[] } | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyDay, setBusyDay] = useState<string | null>(null);
  const editable = !product.managedExternally;

  function merge(updated: OperatorSlotDto[]) {
    const byId = new Map(updated.map((s) => [s.id, s]));
    slots.setData((prev) => (prev ?? []).map((s) => byId.get(s.id) ?? s));
  }

  async function setDayClosed(day: string, list: OperatorSlotDto[], closed: boolean) {
    setBusyDay(day);
    setError(null);
    try {
      const result = await operatorApi.updateSlots(product.id, {
        slotIds: list.map((s) => s.id),
        closed,
      });
      merge(result.slots);
      const label = formatDayLong(day, lang);
      setNotice(
        closed
          ? t('catalog.slots.dayClosed', { day: label })
          : t('catalog.slots.dayReopened', { day: label }),
      );
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusyDay(null);
      setClosingDay(null);
    }
  }

  /** Calls off the departures of a day that have not left yet. */
  function cancelDay(day: string, list: OperatorSlotDto[]) {
    const now = Date.now();
    setClosingDay(null);
    setCancelling({
      title: t('catalog.slots.cancelDayTitle', { day: formatDayLong(day, lang) }),
      list: list.filter((s) => new Date(s.startsAt).getTime() > now),
    });
  }

  const nav = (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={() => setOffset((o) => Math.max(0, o - WINDOW_DAYS))}
        disabled={offset === 0}
        aria-label={tp('catalog.slots.prevDays', WINDOW_DAYS)}
        className="inline-flex size-12 items-center justify-center rounded-xl text-brand hover:bg-brand-soft disabled:opacity-40"
      >
        <IconChevronLeft />
      </button>
      <p className="text-center font-semibold" aria-live="polite">
        {t('catalog.slots.range', {
          from: formatDayLabel(from, lang).day,
          to: formatDayLabel(to, lang).day,
        })}
      </p>
      <button
        type="button"
        onClick={() => setOffset((o) => o + WINDOW_DAYS)}
        disabled={offset >= 365}
        aria-label={tp('catalog.slots.nextDays', WINDOW_DAYS)}
        className="inline-flex size-12 items-center justify-center rounded-xl text-brand hover:bg-brand-soft disabled:opacity-40"
      >
        <IconChevronRight />
      </button>
    </div>
  );

  let body;
  if (slots.loading && !slots.data) body = <LoadingBlock label={t('catalog.slots.loading')} />;
  else if (slots.error) body = <Alert tone="error">{errorMessage(slots.error, i18n)}</Alert>;
  else if (!slots.data || slots.data.length === 0) {
    body = (
      <p className="rounded-2xl bg-surface-2 p-3 text-muted">
        {tp('catalog.slots.none', WINDOW_DAYS)}
      </p>
    );
  } else {
    const byDay = groupSlotsByDay(slots.data, tenant.timezone);
    body = (
      <ul className="flex flex-col gap-2">
        {[...byDay.entries()].map(([day, list]) => {
          const label = formatDayLabel(day, lang);
          const allClosed = list.every((s) => s.closed);
          return (
            <li key={day} className="rounded-2xl bg-surface-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="mr-auto font-semibold">
                  {label.weekday} {label.day}
                </p>
                {editable && cancellable(list) ? (
                  <Button
                    variant="ghost"
                    className="-my-1 text-danger-fg hover:bg-danger-soft"
                    icon={<IconStorm size={20} />}
                    onClick={() => cancelDay(day, list)}
                  >
                    {t('catalog.slots.cancelDay')}
                  </Button>
                ) : null}
                {editable ? (
                  <Button
                    variant="ghost"
                    className="-my-1"
                    loading={busyDay === day}
                    loadingText={t('catalog.slots.saving')}
                    onClick={() =>
                      allClosed
                        ? void setDayClosed(day, list, false)
                        : list.some((s) => s.reserved > 0 && !s.closed)
                          ? setClosingDay({ day, list })
                          : void setDayClosed(day, list, true)
                    }
                  >
                    {allClosed ? t('catalog.slots.reopenDay') : t('catalog.slots.closeDay')}
                  </Button>
                ) : null}
              </div>
              <ul className="mt-2 grid grid-cols-3 gap-2 text-sm sm:grid-cols-4">
                {list.map((slot) => {
                  const content = (
                    <>
                      <span
                        className={`text-base font-semibold tabular-nums ${slot.closed ? 'line-through' : ''}`}
                      >
                        {formatTime(slot.startsAt, tenant.timezone, lang)}
                      </span>
                      <span className="text-xs text-muted">
                        {slot.closed
                          ? t('catalog.slots.closedShort')
                          : t('catalog.slots.free', {
                              available: slot.available,
                              capacity: slot.capacity,
                            })}
                      </span>
                    </>
                  );
                  return (
                    <li key={slot.id}>
                      {editable ? (
                        <button
                          type="button"
                          onClick={() => setEditing(slot)}
                          className={`flex min-h-14 w-full flex-col items-center justify-center rounded-2xl border px-2 py-1 hover:border-brand ${
                            slot.closed
                              ? 'border-dashed border-line-strong bg-transparent'
                              : 'border-line bg-surface'
                          }`}
                          aria-label={
                            slot.closed
                              ? t('catalog.slots.slotAriaClosed', {
                                  time: formatTime(slot.startsAt, tenant.timezone, lang),
                                })
                              : tp('catalog.slots.slotAriaOpen', slot.capacity, {
                                  time: formatTime(slot.startsAt, tenant.timezone, lang),
                                  available: slot.available,
                                })
                          }
                        >
                          {content}
                        </button>
                      ) : (
                        <span className="flex min-h-14 w-full flex-col items-center justify-center rounded-2xl bg-surface px-2 py-1">
                          {content}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {nav}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {body}

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={
          editing
            ? t('catalog.slots.editTitle', {
                day: formatDayLong(todayKeyOf(editing.startsAt, tenant.timezone), lang),
                time: formatTime(editing.startsAt, tenant.timezone, lang),
              })
            : ''
        }
      >
        {editing ? (
          <SlotEditor
            key={editing.id}
            product={product}
            slot={editing}
            onCancelDeparture={() => {
              const slot = editing;
              setEditing(null);
              setCancelling({
                title: t('catalog.slots.cancelSlotTitle', {
                  day: formatDayLong(todayKeyOf(slot.startsAt, tenant.timezone), lang),
                  time: formatTime(slot.startsAt, tenant.timezone, lang),
                }),
                list: [slot],
              });
            }}
            onDone={(message, updated, removedId) => {
              if (updated) merge([updated]);
              if (removedId)
                slots.setData((prev) => (prev ?? []).filter((s) => s.id !== removedId));
              setNotice(message);
              setError(null);
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={!!closingDay}
        onClose={() => setClosingDay(null)}
        title={t('catalog.slots.closeDayTitle')}
        description={
          closingDay
            ? tp(
                'catalog.slots.closeDayDescription',
                closingDay.list.reduce((n, s) => n + (s.closed ? 0 : s.reserved), 0),
                { day: formatDayLong(closingDay.day, lang) },
              )
            : undefined
        }
      >
        {closingDay ? (
          <div className="flex flex-col gap-2">
            {cancellable(closingDay.list) ? (
              <Button
                variant="danger"
                icon={<IconStorm size={20} />}
                onClick={() => cancelDay(closingDay.day, closingDay.list)}
              >
                {t('catalog.slots.cancelAndRefund')}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              loading={busyDay === closingDay.day}
              loadingText={t('catalog.slots.closing')}
              onClick={() => void setDayClosed(closingDay.day, closingDay.list, true)}
            >
              {t('catalog.slots.closeSales')}
            </Button>
            <Button variant="ghost" onClick={() => setClosingDay(null)}>
              {t('catalog.slots.cancel')}
            </Button>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        title={cancelling?.title ?? ''}
        lightDismiss={false}
      >
        {cancelling ? (
          <CancelDeparturesForm
            product={product}
            slots={cancelling.list}
            onCancel={() => setCancelling(null)}
            onDone={(message, updated) => {
              merge(updated);
              setNotice(message);
              setError(null);
              setCancelling(null);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function todayKeyOf(iso: string, tz: string): string {
  return todayKey(tz, new Date(iso));
}

/** One departure: change its seats, close or reopen it, or delete it. */
function SlotEditor({
  product,
  slot,
  onDone,
  onCancelDeparture,
}: {
  product: ProductDto;
  slot: OperatorSlotDto;
  onDone: (message: string, updated?: OperatorSlotDto, removedId?: string) => void;
  onCancelDeparture: () => void;
}) {
  const i18n = useT();
  const { t, tp } = i18n;
  const [capacity, setCapacity] = useState(String(slot.capacity));
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'capacity' | 'closed' | 'delete' | null>(null);

  async function run(kind: 'capacity' | 'closed' | 'delete', action: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err, i18n));
      setBusy(null);
    }
  }

  function saveCapacity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const seats = Number(capacity);
    if (!Number.isInteger(seats) || seats < 1 || seats > 10000) {
      setCapacityError(t('catalog.slots.errCapacity'));
      return;
    }
    if (seats < slot.reserved) {
      setCapacityError(tp('catalog.slots.errBelowReserved', slot.reserved));
      return;
    }
    setCapacityError(null);
    void run('capacity', async () => {
      const result = await operatorApi.updateSlots(product.id, {
        slotIds: [slot.id],
        capacity: seats,
      });
      onDone(tp('catalog.slots.capacitySaved', result.slots[0]!.capacity), result.slots[0]);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-surface-2 p-3">
          <dt className="text-sm text-muted">{t('catalog.slots.reserved')}</dt>
          <dd className="text-xl font-bold tabular-nums">{slot.reserved}</dd>
        </div>
        <div className="rounded-2xl bg-surface-2 p-3">
          <dt className="text-sm text-muted">{t('catalog.slots.available')}</dt>
          <dd className="text-xl font-bold tabular-nums">{slot.closed ? 0 : slot.available}</dd>
        </div>
        <div className="rounded-2xl bg-surface-2 p-3">
          <dt className="text-sm text-muted">{t('catalog.slots.status')}</dt>
          <dd className="mt-1 font-bold">
            {slot.closed ? t('catalog.slots.statusClosed') : t('catalog.slots.statusOpen')}
          </dd>
        </div>
      </dl>

      <form onSubmit={saveCapacity} noValidate className="flex items-end gap-2">
        <Field
          label={t('catalog.slots.totalSeats')}
          name="capacity"
          inputMode="numeric"
          autoComplete="off"
          className="flex-1"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ''))}
          error={capacityError ?? undefined}
        />
        <Button
          type="submit"
          loading={busy === 'capacity'}
          loadingText="…"
          className={capacityError ? 'mb-7' : ''}
        >
          {t('catalog.slots.save')}
        </Button>
      </form>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <Button
          variant="secondary"
          loading={busy === 'closed'}
          loadingText={t('catalog.slots.saving')}
          onClick={() =>
            void run('closed', async () => {
              const result = await operatorApi.updateSlots(product.id, {
                slotIds: [slot.id],
                closed: !slot.closed,
              });
              onDone(
                slot.closed ? t('catalog.slots.reopened') : t('catalog.slots.closedForNew'),
                result.slots[0],
              );
            })
          }
        >
          {slot.closed ? t('catalog.slots.reopenSlot') : t('catalog.slots.closeSlot')}
        </Button>
        {slot.reserved > 0 && !slot.closed ? (
          <p className="text-sm text-muted">{t('catalog.slots.closeHint')}</p>
        ) : null}
        {cancellable([slot]) ? (
          <Button variant="danger" icon={<IconStorm size={20} />} onClick={onCancelDeparture}>
            {t('catalog.slots.cancelSlot')}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          className="text-danger-fg hover:bg-danger-soft"
          loading={busy === 'delete'}
          loadingText={t('catalog.slots.deleting')}
          onClick={() =>
            void run('delete', async () => {
              const result = await operatorApi.deleteSlots(product.id, [slot.id]);
              if (result.deleted === 1) onDone(t('catalog.slots.deleted'), undefined, slot.id);
              else
                onDone(t('catalog.slots.closedInstead'), {
                  ...slot,
                  closed: true,
                });
            })
          }
        >
          {t('catalog.slots.deleteSlot')}
        </Button>
      </div>
    </div>
  );
}

/** Departures with passengers that have not left yet: those can be called off. */
function cancellable(list: OperatorSlotDto[]): boolean {
  const now = Date.now();
  return list.some((s) => s.reserved > 0 && new Date(s.startsAt).getTime() > now);
}

/**
 * Calls off departures (bad weather...): they close to new sales, every booking is cancelled,
 * paid ones are refunded, and each customer gets an email or SMS saying why.
 */
function CancelDeparturesForm({
  product,
  slots,
  onCancel,
  onDone,
}: {
  product: ProductDto;
  slots: OperatorSlotDto[];
  onCancel: () => void;
  onDone: (message: string, updated: OperatorSlotDto[]) => void;
}) {
  const i18n = useT();
  const { t, tp } = i18n;
  const [reason, setReason] = useState<CancelDeparturesBody['reason']>('weather');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seats = slots.reduce((n, s) => n + s.reserved, 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await operatorApi.cancelDepartures(product.id, {
        slotIds: slots.map((s) => s.id),
        reason,
        message: message.trim() || undefined,
      });
      const parts = [tp('catalog.slots.cancelledBookings', result.cancelled)];
      if (result.refunded > 0) parts.push(tp('catalog.slots.cancelledRefunded', result.refunded));
      if (result.failed > 0) parts.push(tp('catalog.slots.cancelledFailed', result.failed));
      onDone(parts.join(' '), result.slots);
    } catch (err) {
      setError(errorMessage(err, i18n));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <p>{tp('catalog.slots.cancelExplain', seats)}</p>
      <ChoiceGroup<CancelDeparturesBody['reason']>
        legend={t('catalog.slots.cancelReason')}
        name="reason"
        value={reason}
        onChange={setReason}
        gridClassName="grid gap-2 sm:grid-cols-2"
        options={[
          { value: 'weather', label: t('catalog.slots.reasonWeather') },
          { value: 'other', label: t('catalog.slots.reasonOther') },
        ]}
      />
      <TextareaField
        label={t('catalog.slots.cancelMessage')}
        optionalText={t('common.optional')}
        hint={t('catalog.slots.cancelMessageHint')}
        name="message"
        rows={3}
        maxLength={300}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t('catalog.slots.keepDepartures')}
        </Button>
        <Button
          type="submit"
          variant="danger"
          loading={busy}
          loadingText={t('catalog.slots.cancellingDepartures')}
        >
          {t('catalog.slots.confirmCancel')}
        </Button>
      </div>
    </form>
  );
}
