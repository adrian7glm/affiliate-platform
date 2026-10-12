'use client';

import { useState } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { PeriodPicker } from '@/components/PeriodPicker';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { PLAN_MODE_EXPLANATION, tierRows } from '@/lib/commission';
import {
  DEFAULT_TIMEZONE,
  currentPeriod,
  formatDate,
  formatPeriod,
  isPeriodKey,
} from '@/lib/dates';
import { affiliateApi } from '@/lib/endpoints';
import { formatBps, formatMoney } from '@/lib/format';
import { COMMISSION_KIND, COMMISSION_STATUS } from '@/lib/labels';
import { useAffiliateHome } from '@/lib/useAffiliateHome';
import { errorMessageRo, useApi } from '@/lib/useApi';

const TZ = DEFAULT_TIMEZONE;

export function EarningsScreen({ initialPeriod }: { initialPeriod?: string }) {
  const thisMonth = currentPeriod(TZ);
  const [period, setPeriod] = useState(() =>
    isPeriodKey(initialPeriod) && initialPeriod <= thisMonth ? initialPeriod : thisMonth,
  );
  const earnings = useApi(`earnings:${period}`, (signal) =>
    affiliateApi.earnings(period, { signal }),
  );
  const home = useAffiliateHome();
  const plan = home.data?.plan;
  const data = earnings.data;

  return (
    <div className="page-x mx-auto flex max-w-xl flex-col gap-4">
      <PageHeader title="Câștigurile mele" />

      <PeriodPicker period={period} onChange={setPeriod} maxPeriod={thisMonth} />

      {earnings.loading && !data ? <LoadingBlock /> : null}
      {earnings.error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={earnings.reload}>
              Încearcă din nou
            </Button>
          }
        >
          {errorMessageRo(earnings.error)}
        </Alert>
      ) : null}

      {data ? (
        <>
          <Card>
            <p className="font-semibold text-muted">Total în {formatPeriod(data.periodKey)}</p>
            <p className="mt-1 text-4xl font-extrabold tracking-tight">
              <MoneyText amountMinor={data.totalMinor} currency={data.currency} />
            </p>
          </Card>

          <Card title="Vânzări și ajustări">
            {data.entries.length === 0 ? (
              <p className="text-muted">Nicio vânzare în {formatPeriod(data.periodKey)}.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.entries.map((entry) => {
                  const status = COMMISSION_STATUS[entry.status];
                  const negative = entry.amountMinor < 0;
                  return (
                    <li key={entry.id} className="flex flex-col gap-1.5 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold">{entry.productName}</p>
                          <p className="text-sm text-muted">
                            {entry.kind !== 'sale' ? `${COMMISSION_KIND[entry.kind]} · ` : ''}
                            {formatDate(entry.createdAt, TZ)} · cod {entry.bookingReference}
                          </p>
                        </div>
                        <MoneyText
                          amountMinor={entry.amountMinor}
                          currency={data.currency}
                          className={`text-lg font-bold ${negative ? 'text-danger-fg' : ''}`}
                        />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm text-muted">
                          {formatBps(entry.rateBps)} din{' '}
                          {formatMoney(entry.baseMinor, data.currency)}
                        </span>
                        <StatusChip tone={status.tone}>{status.label}</StatusChip>
                      </div>
                      {entry.reason && entry.kind !== 'sale' ? (
                        <p className="text-sm text-muted">{entry.reason}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      ) : null}

      <Card title="Cum se calculează">
        {plan ? (
          plan.kind === 'fixed' || plan.tiers.length <= 1 ? (
            <p>
              Primești{' '}
              <strong>
                {formatBps(home.data?.progress.currentRateBps ?? plan.tiers[0]?.rateBps ?? 0)}
              </strong>{' '}
              din fiecare rezervare plătită.
            </p>
          ) : (
            <>
              <table className="w-full border-collapse text-left">
                <caption className="mb-2 text-left text-muted">
                  Procentul crește cu numărul de vânzări din lună.
                </caption>
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="py-2 font-semibold">
                      Vânzări în lună
                    </th>
                    <th scope="col" className="py-2 text-right font-semibold">
                      Comision
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tierRows(plan.tiers).map((row, i) => (
                    <tr
                      key={row.label}
                      className={`border-b border-line ${home.data?.progress.tierIndex === i ? 'font-semibold text-brand' : ''}`}
                    >
                      <th scope="row" className="py-2.5 font-normal">
                        {row.label}
                        {home.data?.progress.tierIndex === i ? (
                          <span className="ml-2 text-sm">(acum)</span>
                        ) : null}
                      </th>
                      <td className="py-2.5 text-right tabular-nums">{formatBps(row.rateBps)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.mode ? (
                <p className="mt-3 text-sm text-muted">{PLAN_MODE_EXPLANATION[plan.mode]}</p>
              ) : null}
            </>
          )
        ) : (
          <p className="text-muted">Planul de comision se încarcă…</p>
        )}

        <dl className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          <div>
            <dt>
              <StatusChip tone={COMMISSION_STATUS.pending.tone}>
                {COMMISSION_STATUS.pending.label}
              </StatusChip>
            </dt>
            <dd className="mt-1 text-sm text-muted">
              Rezervarea e plătită, dar excursia nu a avut loc încă.
            </dd>
          </div>
          <div>
            <dt>
              <StatusChip tone={COMMISSION_STATUS.approved.tone}>
                {COMMISSION_STATUS.approved.label}
              </StatusChip>
            </dt>
            <dd className="mt-1 text-sm text-muted">
              Excursia a avut loc. Suma intră la următoarea plată de la operator.
            </dd>
          </div>
          <div>
            <dt>
              <StatusChip tone={COMMISSION_STATUS.paid.tone}>
                {COMMISSION_STATUS.paid.label}
              </StatusChip>
            </dt>
            <dd className="mt-1 text-sm text-muted">Operatorul ți-a plătit suma.</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-muted">
          Dacă o rezervare este anulată și rambursată, comisionul ei se scade.
        </p>
      </Card>
    </div>
  );
}
