'use client';

import type { SlotDto } from '@ap/contracts';
import { useMemo } from 'react';
import { groupSlotsByDay } from '@/lib/booking';
import { formatDayLabel, formatTime } from '@/lib/dates';
import type { Translator } from '@/lib/i18n';
import { useT } from '../I18nProvider';

interface SlotPickerProps {
  days: string[];
  slots: SlotDto[];
  timezone: string;
  /** Defaults to the page language from the provider. */
  t?: Translator;
  date: string | null;
  onDateChange: (date: string) => void;
  slotId: string | null;
  onSlotChange: (slot: SlotDto) => void;
  /** Field-level error under the time grid (e.g. "choose a time"). */
  error?: string | null;
}

/**
 * Date chips for the next days (4 per row on phones, no horizontal scrolling) and the
 * departures of the chosen day with the seats left. Both are native radio groups.
 */
export function SlotPicker({
  days,
  slots,
  timezone,
  t: given,
  date,
  onDateChange,
  slotId,
  onSlotChange,
  error,
}: SlotPickerProps) {
  const current = useT();
  const t = given ?? current;
  const byDay = useMemo(() => groupSlotsByDay(slots, timezone), [slots, timezone]);
  const daySlots = date ? (byDay.get(date) ?? []) : [];

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="min-w-0">
        <legend className="mb-2 text-lg font-semibold">{t.t('public.chooseDate')}</legend>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {days.map((day, index) => {
            const label = formatDayLabel(day, t.lang);
            const hasSeats = (byDay.get(day) ?? []).some((s) => s.available > 0);
            const top = index === 0 ? t.t('public.today') : index === 1 ? t.t('public.tomorrow') : label.weekday;
            return (
              <label key={day} className="choice">
                <input
                  type="radio"
                  name="date"
                  value={day}
                  checked={date === day}
                  onChange={() => onDateChange(day)}
                  aria-describedby={hasSeats ? undefined : `nodep-${day}`}
                />
                <span
                  className={`choice-body items-center text-center ${hasSeats ? '' : 'opacity-60'}`}
                >
                  <span className="text-xs font-semibold uppercase tracking-wide">{top}</span>
                  <span className="text-base font-bold">{label.day}</span>
                  {hasSeats ? null : (
                    <span id={`nodep-${day}`} className="visually-hidden">
                      {t.t('public.noDeparturesOnDay')}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {date ? (
        <fieldset className="min-w-0" aria-describedby={error ? 'slot-error' : undefined}>
          <legend className="mb-2 text-lg font-semibold">{t.t('public.chooseTime')}</legend>
          {daySlots.length === 0 ? (
            <p className="rounded-2xl bg-surface-2 p-4 text-muted">{t.t('public.noDeparturesOnDay')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-3">
              {daySlots.map((slot) => {
                const soldOut = slot.available <= 0;
                return (
                  <label key={slot.id} className="choice">
                    <input
                      type="radio"
                      name="slot"
                      value={slot.id}
                      checked={slotId === slot.id}
                      disabled={soldOut}
                      onChange={() => onSlotChange(slot)}
                    />
                    <span className="choice-body min-h-16 items-center text-center">
                      <span className="text-xl font-bold tabular-nums">
                        {formatTime(slot.startsAt, timezone, t.lang)}
                      </span>
                      <span className="text-sm">
                        {soldOut ? t.t('public.soldOut') : t.tp('public.seatsLeft', slot.available)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {error ? (
            <p id="slot-error" role="alert" className="mt-2 font-medium text-danger-fg">
              {error}
            </p>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}
