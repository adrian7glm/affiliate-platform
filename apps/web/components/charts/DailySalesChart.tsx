'use client';

import type { OperatorAnalyticsDto } from '@ap/contracts';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useT } from '@/components/I18nProvider';
import { MoneyText } from '@/components/MoneyText';
import { compactMoney, dayTicks, niceMax } from '@/lib/analytics';
import { formatDayLong } from '@/lib/dates';
import { formatMoney } from '@/lib/format';

type Day = OperatorAnalyticsDto['daily'][number];

const SERIES = [
  { key: 'affiliate', label: 'charts.affiliate', color: 'bg-viz-1' },
  { key: 'direct', label: 'charts.direct', color: 'bg-viz-2' },
] as const;

/**
 * Revenue per day of the month, each column split into sales through affiliates and direct
 * sales. Tapping, hovering or arrowing onto a day shows its numbers in the readout above, so the
 * chart works the same with a thumb, a mouse or a keyboard; the table below has every value.
 */
export function DailySalesChart({
  daily,
  throughDate,
  currency,
  summaryTitle,
}: {
  daily: Day[];
  throughDate: string;
  currency: string;
  /** Readout heading while no day is picked, e.g. "Whole month" (translated by the caller). */
  summaryTitle: string;
}) {
  const { t, lang } = useT();
  const lastIndex = Math.max(
    0,
    daily.findIndex((d) => d.date === throughDate),
  );
  // A tapped, clicked or focused day stays picked; hovering with a mouse only previews a day.
  const [picked, setPicked] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const active = hovered ?? picked;
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const shown = active ?? lastIndex;
  // Nothing picked yet: the readout sums the month so far instead of showing an empty today.
  const elapsed = daily.slice(0, lastIndex + 1);
  const readout =
    active !== null && daily[active]
      ? { title: formatDayLong(daily[active].date, lang), ...daily[active] }
      : {
          title: summaryTitle,
          bookings: elapsed.reduce((sum, d) => sum + d.bookings, 0),
          revenueMinor: elapsed.reduce((sum, d) => sum + d.revenueMinor, 0),
          affiliateRevenueMinor: elapsed.reduce((sum, d) => sum + d.affiliateRevenueMinor, 0),
        };
  const day = readout;
  const max = niceMax(Math.max(0, ...daily.map((d) => d.revenueMinor)));
  // Today's number is always shown, so drop a regular label that would touch it.
  const today = lastIndex + 1;
  const ticks = dayTicks(daily.length).filter((n) => n === today || Math.abs(n - today) > 2);
  const pct = (minor: number) => `${(minor / max) * 100}%`;

  function focusDay(index: number) {
    const next = Math.min(lastIndex, Math.max(0, index));
    setPicked(next);
    buttons.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const moves: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      Home: 0,
      End: lastIndex,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    focusDay(target);
  }

  function onPointerLeave(event: PointerEvent) {
    if (event.pointerType === 'mouse') setHovered(null);
  }

  const withSales = daily.filter((d, i) => i <= lastIndex && d.bookings > 0);

  return (
    <div className="flex flex-col gap-3">
      {day ? (
        <div aria-live="polite" className="rounded-2xl bg-surface-2 px-3 py-2">
          <p className="text-sm font-semibold text-muted first-letter:uppercase">{day.title}</p>
          <p className="text-2xl font-extrabold tracking-tight">
            <MoneyText amountMinor={day.revenueMinor} currency={currency} lang={lang} />
            <span className="ml-2 text-base font-semibold text-muted">
              {t('charts.bookings', { count: day.bookings })}
            </span>
          </p>
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {SERIES.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`h-0.5 w-3 rounded-full ${s.color}`} />
                <dt className="text-muted">{t(s.label)}</dt>
                <dd className="font-semibold">
                  <MoneyText
                    amountMinor={
                      s.key === 'affiliate'
                        ? day.affiliateRevenueMinor
                        : day.revenueMinor - day.affiliateRevenueMinor
                    }
                    currency={currency}
                    lang={lang}
                  />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      <div className="flex gap-2">
        {/* Y axis: three round values, the gridlines continue them across the plot. */}
        <div
          aria-hidden="true"
          className="relative h-44 w-10 shrink-0 text-right text-xs tabular-nums text-muted"
        >
          {[max, max / 2, 0].map((value, i) => (
            <span
              key={value}
              className="absolute right-0 -translate-y-1/2 leading-none"
              style={{ top: `${i * 50}%` }}
            >
              {compactMoney(value, currency, lang)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div
            role="group"
            aria-label={t('charts.revenueByDay')}
            className="relative h-44"
            onPointerLeave={onPointerLeave}
          >
            {[0, 50, 100].map((top) => (
              <div
                key={top}
                aria-hidden="true"
                className={`absolute inset-x-0 border-t ${top === 100 ? 'border-line-strong' : 'border-line'}`}
                style={{ top: `${top}%` }}
              />
            ))}
            <div className="absolute inset-0 flex">
              {daily.map((d, i) => {
                const future = i > lastIndex;
                const direct = d.revenueMinor - d.affiliateRevenueMinor;
                const label = t('charts.dayBar', {
                  day: formatDayLong(d.date, lang),
                  amount: formatMoney(d.revenueMinor, currency, lang),
                  count: d.bookings,
                });
                return (
                  <button
                    key={d.date}
                    ref={(el) => {
                      buttons.current[i] = el;
                    }}
                    type="button"
                    disabled={future}
                    tabIndex={i === shown ? 0 : -1}
                    aria-label={label}
                    aria-pressed={i === active}
                    onClick={() => setPicked(i)}
                    onFocus={() => setPicked(i)}
                    onPointerEnter={(e) => {
                      if (e.pointerType === 'mouse') setHovered(i);
                    }}
                    onKeyDown={(e) => onKeyDown(e, i)}
                    className={`flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end rounded-t-md outline-offset-0 disabled:cursor-default ${
                      i === active ? 'bg-brand-soft/60' : ''
                    }`}
                  >
                    {/* Direct on top, affiliates at the baseline; a 2px gap keeps them apart. */}
                    <span
                      className="flex h-full w-[70%] max-w-6 flex-col justify-end gap-[2px]"
                      aria-hidden="true"
                    >
                      {direct > 0 ? (
                        <span
                          className="block min-h-[2px] shrink-0 rounded-t bg-viz-2"
                          style={{ height: pct(direct) }}
                        />
                      ) : null}
                      {d.affiliateRevenueMinor > 0 ? (
                        <span
                          className={`block min-h-[2px] shrink-0 bg-viz-1 ${direct > 0 ? '' : 'rounded-t'}`}
                          style={{ height: pct(d.affiliateRevenueMinor) }}
                        />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* X axis: day numbers under their columns. */}
          <div aria-hidden="true" className="mt-1 flex text-xs tabular-nums text-muted">
            {daily.map((d, i) => {
              const n = i + 1;
              // Bold "today" only while the month is running; a finished month just ends.
              const isToday = i === lastIndex && lastIndex < daily.length - 1;
              return (
                <span key={d.date} className="relative flex-1 text-center">
                  {ticks.includes(n) || isToday ? (
                    <span
                      className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap ${
                        isToday ? 'font-bold text-fg' : ''
                      }`}
                    >
                      {n}
                    </span>
                  ) : null}
                  &nbsp;
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label={t('charts.legend')}>
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`size-3 rounded-sm ${s.color}`} />
            {t(s.label)}
          </li>
        ))}
      </ul>

      <details className="group">
        <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold text-brand">
          {t('charts.showTable')}
        </summary>
        {withSales.length === 0 ? (
          <p className="text-muted">{t('charts.noSales')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    {t('charts.colDay')}
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    {t('charts.colBookings')}
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    {t('charts.affiliate')}
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    {t('charts.colTotal')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {withSales.map((d) => (
                  <tr key={d.date} className="border-b border-line last:border-0">
                    <th scope="row" className="py-2 pr-3 font-semibold first-letter:uppercase">
                      {formatDayLong(d.date, lang)}
                    </th>
                    <td className="py-2 pr-3 text-right tabular-nums">{d.bookings}</td>
                    <td className="py-2 pr-3 text-right">
                      <MoneyText
                        amountMinor={d.affiliateRevenueMinor}
                        currency={currency}
                        lang={lang}
                      />
                    </td>
                    <td className="py-2 text-right font-semibold">
                      <MoneyText amountMinor={d.revenueMinor} currency={currency} lang={lang} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </div>
  );
}
