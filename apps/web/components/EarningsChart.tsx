'use client';

import type { AffiliateMonthDto } from '@ap/contracts';
import Link from 'next/link';
import { formatPeriod } from '@/lib/dates';
import { formatMoney } from '@/lib/format';
import { shortMonth } from '@/lib/insights';
import { useT } from './I18nProvider';

/**
 * Commission per month as columns, the current month last and highlighted. Each column opens
 * that month's earnings. Values are labelled on the current and the best month only; the rest
 * are in each column's accessible name and in the hidden table.
 */
export function EarningsChart({
  history,
  currency,
}: {
  history: AffiliateMonthDto[];
  currency: string;
}) {
  const { t, lang } = useT();
  const values = history.map((m) => Math.max(0, m.commissionMinor));
  const max = Math.max(...values, 1);
  const bestIndex = values.indexOf(Math.max(...values));
  const last = history.length - 1;

  return (
    <figure className="m-0">
      <ol
        className="grid h-44 items-end gap-2"
        style={{ gridTemplateColumns: `repeat(${history.length}, minmax(0, 1fr))` }}
        aria-label={t('charts.earningsLabel')}
      >
        {history.map((month, i) => {
          const current = i === last;
          const value = values[i]!;
          const showValue = value > 0 && (current || i === bestIndex);
          // Keep a sliver for empty months so the axis still reads as months.
          const height = value > 0 ? Math.max(6, (value / max) * 100) : 2;
          return (
            <li key={month.periodKey} className="flex h-full min-w-0 flex-col">
              <Link
                href={`/a/earnings?period=${month.periodKey}`}
                className="group flex h-full flex-col items-center justify-end gap-1 rounded-xl pt-1"
                aria-label={t('charts.earningsBar', {
                  month: formatPeriod(month.periodKey, lang),
                  amount: formatMoney(month.commissionMinor, currency, lang),
                  count: month.paidSales,
                })}
              >
                <span
                  className={`whitespace-nowrap text-xs font-semibold tabular-nums ${showValue ? '' : 'invisible'} ${current ? 'text-fg' : 'text-muted'}`}
                  aria-hidden="true"
                >
                  {formatMoney(value, currency, lang)}
                </span>
                <span
                  className={`block w-full max-w-12 rounded-t-[4px] transition-opacity group-hover:opacity-80 ${current ? 'bg-brand' : 'bg-line-strong/45'}`}
                  style={{ height: `${height}%` }}
                  aria-hidden="true"
                />
              </Link>
            </li>
          );
        })}
      </ol>
      <div
        className="mt-1.5 grid gap-2 border-t border-line pt-1.5 text-center text-xs text-muted"
        style={{ gridTemplateColumns: `repeat(${history.length}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {history.map((month, i) => (
          <span key={month.periodKey} className={i === last ? 'font-bold text-fg' : ''}>
            {shortMonth(month.periodKey, lang)}
          </span>
        ))}
      </div>
      <figcaption className="visually-hidden">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('charts.colMonth')}</th>
              <th scope="col">{t('charts.colSales')}</th>
              <th scope="col">{t('charts.colCommission')}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((m) => (
              <tr key={m.periodKey}>
                <th scope="row">{formatPeriod(m.periodKey, lang)}</th>
                <td>{m.paidSales}</td>
                <td>{formatMoney(m.commissionMinor, currency, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
