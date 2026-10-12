'use client';

import { useId, type ReactNode } from 'react';
import { IconMinus, IconPlus } from './icons';

export interface StepperProps {
  label: string;
  description?: ReactNode;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Accessible names of the − / + buttons (localized by the caller). */
  decreaseLabel?: string;
  increaseLabel?: string;
}

/** Quantity picker with big − / + buttons, made for one-handed use. */
export function Stepper({
  label,
  description,
  value,
  onChange,
  min = 0,
  max = 50,
  decreaseLabel = `Scade ${label}`,
  increaseLabel = `Crește ${label}`,
}: StepperProps) {
  const labelId = useId();
  const canDecrease = value > min;
  const canIncrease = value < max;

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="flex items-center justify-between gap-3 py-2"
    >
      <div className="min-w-0">
        <div id={labelId} className="font-semibold">
          {label}
        </div>
        {description ? <div className="text-sm text-muted">{description}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="inline-flex size-12 items-center justify-center rounded-full border-2 border-line-strong bg-surface text-fg disabled:opacity-40"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={!canDecrease}
          aria-label={decreaseLabel}
        >
          <IconMinus />
        </button>
        <output
          aria-live="polite"
          aria-atomic="true"
          className="w-10 text-center text-xl font-bold tabular-nums"
          data-testid="stepper-value"
        >
          {value}
        </output>
        <button
          type="button"
          className="inline-flex size-12 items-center justify-center rounded-full border-2 border-transparent bg-brand text-on-brand disabled:opacity-40"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={!canIncrease}
          aria-label={increaseLabel}
        >
          <IconPlus />
        </button>
      </div>
    </div>
  );
}
