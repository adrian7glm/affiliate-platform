import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg',
  brand: 'bg-brand-soft text-brand-soft-fg',
  success: 'bg-success-soft text-success-fg',
  warning: 'bg-warning-soft text-warning-fg',
  danger: 'bg-danger-soft text-danger-fg',
};

/** Shape differs per tone so the state never relies on color alone (the text says it too). */
const MARKS: Record<Tone, ReactNode> = {
  neutral: <circle cx="5" cy="5" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />,
  brand: <circle cx="5" cy="5" r="3.2" fill="currentColor" />,
  success: (
    <path
      d="M1.8 5.2 4 7.4 8.4 2.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  ),
  warning: (
    <path d="M5 1.5v4.2M5 8.2v.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  ),
  danger: (
    <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  ),
};

export function StatusChip({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-transparent px-2.5 py-1 text-sm font-semibold ${TONES[tone]}`}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        {MARKS[tone]}
      </svg>
      {children}
    </span>
  );
}
