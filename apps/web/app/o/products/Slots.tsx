'use client';

import type { ProductDto } from '@ap/contracts';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Field, INPUT_CLASSES } from '@/components/Field';
import { IconPlus, IconX } from '@/components/icons';
import { LoadingBlock } from '@/components/Spinner';
import { groupSlotsByDay } from '@/lib/booking';
import { addDays, formatDayLabel, formatTime, todayKey } from '@/lib/dates';
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

/** Next 14 days of departures for a product, grouped by day. */
export function UpcomingSlots({ productId }: { productId: string }) {
  const { tenant } = useOperator();
  const from = todayKey(tenant.timezone);
  const to = addDays(from, 13);
  const slots = useApi(`operator-slots:${productId}`, (signal) =>
    operatorApi.slots(productId, { from, to }, { signal }),
  );

  if (slots.loading && !slots.data) return <LoadingBlock label="Se încarcă plecările…" />;
  if (slots.error) return <Alert tone="error">{errorMessageRo(slots.error)}</Alert>;
  if (!slots.data || slots.data.length === 0) {
    return (
      <p className="rounded-2xl bg-surface-2 p-3 text-muted">
        Nicio plecare în următoarele 14 zile.
      </p>
    );
  }
  const byDay = groupSlotsByDay(slots.data, tenant.timezone);
  return (
    <ul className="flex flex-col gap-2">
      {[...byDay.entries()].map(([day, list]) => {
        const label = formatDayLabel(day);
        return (
          <li key={day} className="rounded-2xl bg-surface-2 p-3">
            <p className="font-semibold">
              {label.weekday} {label.day}
            </p>
            <ul className="mt-1 flex flex-wrap gap-2 text-sm">
              {list.map((slot) => (
                <li key={slot.id} className="rounded-full bg-surface px-3 py-1">
                  <span className="font-semibold tabular-nums">
                    {formatTime(slot.startsAt, tenant.timezone)}
                  </span>{' '}
                  <span className="text-muted">
                    {slot.available}/{slot.capacity} libere
                  </span>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
