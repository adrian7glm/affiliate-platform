'use client';

import type { OperatorSlotDto, ProductDto } from '@ap/contracts';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Field, INPUT_CLASSES } from '@/components/Field';
import { IconChevronLeft, IconChevronRight, IconPlus, IconX } from '@/components/icons';
import { LoadingBlock } from '@/components/Spinner';
import { groupSlotsByDay } from '@/lib/booking';
import { addDays, formatDayLabel, formatDayLong, formatTime, todayKey } from '@/lib/dates';
import { operatorApi } from '@/lib/endpoints';
import { errorMessageRo, useApi } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';

const WEEKDAYS = [
  { value: 1, short: 'Lu', long: 'Luni' },
  { value: 2, short: 'Ma', long: 'Marți' },
  { value: 3, short: 'Mi', long: 'Miercuri' },
  { value: 4, short: 'Jo', long: 'Joi' },
  { value: 5, short: 'Vi', long: 'Vineri' },
  { value: 6, short: 'Sâ', long: 'Sâmbătă' },
  { value: 7, short: 'Du', long: 'Duminică' },
];

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
      setErrors((e) => ({ ...e, times: 'Alege o oră validă, ex. 17:30.' }));
      return;
    }
    setTimes((prev) => (prev.includes(newTime) ? prev : [...prev, newTime].sort()));
    setErrors(({ times: _ignored, ...rest }) => rest);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!fromDate || !toDate || toDate < fromDate)
      next.dates = 'Data de sfârșit trebuie să fie după data de început.';
    if (times.length === 0) next.times = 'Adaugă cel puțin o oră de plecare.';
    if (weekdays.length === 0) next.weekdays = 'Alege cel puțin o zi a săptămânii.';
    const seats = Number(capacity);
    if (!Number.isInteger(seats) || seats < 1 || seats > 10000)
      next.capacity = 'Între 1 și 10000 de locuri.';
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
      setError(errorMessageRo(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="De la"
          type="date"
          name="fromDate"
          required
          value={fromDate}
          min={today}
          onChange={(e) => setFromDate(e.target.value)}
        />
        <Field
          label="Până la"
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
        <legend className="mb-1.5 font-semibold">Orele de plecare</legend>
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
                onClick={() => setTimes((prev) => prev.filter((t) => t !== time))}
                aria-label={`Șterge ora ${time}`}
              >
                <IconX size={18} />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="visually-hidden">Oră nouă</span>
            <input
              type="time"
              className={INPUT_CLASSES}
              value={newTime}
              step={300}
              onChange={(e) => setNewTime(e.target.value)}
            />
          </label>
          <Button variant="secondary" icon={<IconPlus />} onClick={addTime}>
            Adaugă ora
          </Button>
        </div>
        {errors.times ? (
          <p className="mt-1.5 text-sm font-medium text-danger-fg">{errors.times}</p>
        ) : null}
      </fieldset>

      <fieldset className="min-w-0">
        <legend className="mb-1.5 font-semibold">Zilele săptămânii</legend>
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
                {day.short}
              </span>
              <span className="visually-hidden">{day.long}</span>
            </label>
          ))}
        </div>
        {errors.weekdays ? (
          <p className="mt-1.5 text-sm font-medium text-danger-fg">{errors.weekdays}</p>
        ) : null}
      </fieldset>

      <Field
        label="Locuri la fiecare plecare"
        name="capacity"
        inputMode="numeric"
        autoComplete="off"
        required
        value={capacity}
        onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ''))}
        error={errors.capacity}
      />

      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" size="lg" block loading={busy} loadingText="Se creează…">
        Creează plecările
      </Button>
    </form>
  );
}

const WINDOW_DAYS = 14;

function seatsText(n: number): string {
  return n === 1 ? '1 loc' : `${n} locuri`;
}

/**
 * Departures of a trip, two weeks at a time, grouped by day. For the operator's own calendar
 * each departure can be resized, closed or deleted, and a whole day closed at once (bad weather).
 */
export function UpcomingSlots({ product }: { product: ProductDto }) {
  const { tenant } = useOperator();
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
      const label = formatDayLong(day);
      setNotice(
        closed ? `Plecările din ${label} sunt închise.` : `Plecările din ${label} sunt redeschise.`,
      );
    } catch (err) {
      setError(errorMessageRo(err));
    } finally {
      setBusyDay(null);
      setClosingDay(null);
    }
  }

  const nav = (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={() => setOffset((o) => Math.max(0, o - WINDOW_DAYS))}
        disabled={offset === 0}
        aria-label="Cele 14 zile dinainte"
        className="inline-flex size-12 items-center justify-center rounded-xl text-brand hover:bg-brand-soft disabled:opacity-40"
      >
        <IconChevronLeft />
      </button>
      <p className="text-center font-semibold" aria-live="polite">
        {formatDayLabel(from).day} – {formatDayLabel(to).day}
      </p>
      <button
        type="button"
        onClick={() => setOffset((o) => o + WINDOW_DAYS)}
        disabled={offset >= 365}
        aria-label="Următoarele 14 zile"
        className="inline-flex size-12 items-center justify-center rounded-xl text-brand hover:bg-brand-soft disabled:opacity-40"
      >
        <IconChevronRight />
      </button>
    </div>
  );

  let body;
  if (slots.loading && !slots.data) body = <LoadingBlock label="Se încarcă plecările…" />;
  else if (slots.error) body = <Alert tone="error">{errorMessageRo(slots.error)}</Alert>;
  else if (!slots.data || slots.data.length === 0) {
    body = (
      <p className="rounded-2xl bg-surface-2 p-3 text-muted">Nicio plecare în aceste 14 zile.</p>
    );
  } else {
    const byDay = groupSlotsByDay(slots.data, tenant.timezone);
    body = (
      <ul className="flex flex-col gap-2">
        {[...byDay.entries()].map(([day, list]) => {
          const label = formatDayLabel(day);
          const allClosed = list.every((s) => s.closed);
          return (
            <li key={day} className="rounded-2xl bg-surface-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  {label.weekday} {label.day}
                </p>
                {editable ? (
                  <Button
                    variant="ghost"
                    className="-my-1"
                    loading={busyDay === day}
                    loadingText="Se salvează…"
                    onClick={() =>
                      allClosed
                        ? void setDayClosed(day, list, false)
                        : list.some((s) => s.reserved > 0 && !s.closed)
                          ? setClosingDay({ day, list })
                          : void setDayClosed(day, list, true)
                    }
                  >
                    {allClosed ? 'Redeschide ziua' : 'Închide ziua'}
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
                        {formatTime(slot.startsAt, tenant.timezone)}
                      </span>
                      <span className="text-xs text-muted">
                        {slot.closed ? 'închisă' : `${slot.available}/${slot.capacity} libere`}
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
                          aria-label={`${formatTime(slot.startsAt, tenant.timezone)}, ${
                            slot.closed
                              ? 'închisă'
                              : `${slot.available} din ${slot.capacity} locuri libere`
                          }. Modifică plecarea`}
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
            ? `Plecarea de ${formatDayLong(todayKeyOf(editing.startsAt, tenant.timezone))}, ${formatTime(editing.startsAt, tenant.timezone)}`
            : ''
        }
      >
        {editing ? (
          <SlotEditor
            key={editing.id}
            product={product}
            slot={editing}
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
        title="Închizi ziua?"
        description={
          closingDay
            ? `Sunt ${seatsText(closingDay.list.reduce((n, s) => n + (s.closed ? 0 : s.reserved), 0))} rezervate în ${formatDayLong(closingDay.day)}. Biletele rămân valabile; anunță clienții dacă excursia nu mai are loc.`
            : undefined
        }
      >
        {closingDay ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="secondary" onClick={() => setClosingDay(null)}>
              Renunță
            </Button>
            <Button
              variant="danger"
              loading={busyDay === closingDay.day}
              loadingText="Se închide…"
              onClick={() => void setDayClosed(closingDay.day, closingDay.list, true)}
            >
              Închide vânzările
            </Button>
          </div>
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
}: {
  product: ProductDto;
  slot: OperatorSlotDto;
  onDone: (message: string, updated?: OperatorSlotDto, removedId?: string) => void;
}) {
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
      setError(errorMessageRo(err));
      setBusy(null);
    }
  }

  function saveCapacity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const seats = Number(capacity);
    if (!Number.isInteger(seats) || seats < 1 || seats > 10000) {
      setCapacityError('Între 1 și 10000 de locuri.');
      return;
    }
    if (seats < slot.reserved) {
      setCapacityError(`Sunt deja ${seatsText(slot.reserved)} rezervate; nu poți scădea sub atât.`);
      return;
    }
    setCapacityError(null);
    void run('capacity', async () => {
      const result = await operatorApi.updateSlots(product.id, {
        slotIds: [slot.id],
        capacity: seats,
      });
      onDone(`Plecarea are acum ${seatsText(result.slots[0]!.capacity)}.`, result.slots[0]);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-surface-2 p-3">
          <dt className="text-sm text-muted">Rezervate</dt>
          <dd className="text-xl font-bold tabular-nums">{slot.reserved}</dd>
        </div>
        <div className="rounded-2xl bg-surface-2 p-3">
          <dt className="text-sm text-muted">Libere</dt>
          <dd className="text-xl font-bold tabular-nums">{slot.closed ? 0 : slot.available}</dd>
        </div>
        <div className="rounded-2xl bg-surface-2 p-3">
          <dt className="text-sm text-muted">Stare</dt>
          <dd className="mt-1 font-bold">{slot.closed ? 'Închisă' : 'Deschisă'}</dd>
        </div>
      </dl>

      <form onSubmit={saveCapacity} noValidate className="flex items-end gap-2">
        <Field
          label="Locuri în total"
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
          Salvează
        </Button>
      </form>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <Button
          variant="secondary"
          loading={busy === 'closed'}
          loadingText="Se salvează…"
          onClick={() =>
            void run('closed', async () => {
              const result = await operatorApi.updateSlots(product.id, {
                slotIds: [slot.id],
                closed: !slot.closed,
              });
              onDone(
                slot.closed
                  ? 'Plecarea e din nou deschisă.'
                  : 'Plecarea e închisă pentru rezervări noi.',
                result.slots[0],
              );
            })
          }
        >
          {slot.closed ? 'Redeschide plecarea' : 'Închide plecarea'}
        </Button>
        {slot.reserved > 0 && !slot.closed ? (
          <p className="text-sm text-muted">
            Închiderea oprește doar rezervările noi; biletele vândute rămân valabile.
          </p>
        ) : null}
        <Button
          variant="ghost"
          className="text-danger-fg hover:bg-danger-soft"
          loading={busy === 'delete'}
          loadingText="Se șterge…"
          onClick={() =>
            void run('delete', async () => {
              const result = await operatorApi.deleteSlots(product.id, [slot.id]);
              if (result.deleted === 1) onDone('Plecarea a fost ștearsă.', undefined, slot.id);
              else
                onDone('Plecarea are rezervări, așa că a fost închisă în loc să fie ștearsă.', {
                  ...slot,
                  closed: true,
                });
            })
          }
        >
          Șterge plecarea
        </Button>
      </div>
    </div>
  );
}
