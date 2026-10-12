'use client';

import { formatPeriod, shiftPeriod } from '@/lib/dates';
import { IconChevronLeft, IconChevronRight } from './icons';

/** Month switcher with large previous/next buttons. Cannot go past `maxPeriod`. */
export function PeriodPicker({
  period,
  onChange,
  maxPeriod,
  label = 'Luna',
}: {
  period: string;
  onChange: (period: string) => void;
  maxPeriod?: string;
  label?: string;
}) {
  const canNext = !maxPeriod || period < maxPeriod;
  const name = formatPeriod(period);
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center justify-between gap-2 rounded-2xl bg-surface p-1.5 border border-line"
    >
      <button
        type="button"
        onClick={() => onChange(shiftPeriod(period, -1))}
        className="inline-flex size-12 items-center justify-center rounded-xl hover:bg-surface-2"
        aria-label={`Luna anterioară: ${formatPeriod(shiftPeriod(period, -1))}`}
      >
        <IconChevronLeft />
      </button>
      <output aria-live="polite" className="text-lg font-semibold first-letter:uppercase">
        {name}
      </output>
      <button
        type="button"
        onClick={() => onChange(shiftPeriod(period, 1))}
        disabled={!canNext}
        className="inline-flex size-12 items-center justify-center rounded-xl hover:bg-surface-2 disabled:opacity-30"
        aria-label={`Luna următoare: ${formatPeriod(shiftPeriod(period, 1))}`}
      >
        <IconChevronRight />
      </button>
    </div>
  );
}
