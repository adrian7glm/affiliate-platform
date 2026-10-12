'use client';

import { useState } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useT } from '@/components/I18nProvider';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { PeriodPicker } from '@/components/PeriodPicker';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { planModeExplanation, tierRows } from '@/lib/commission';
import {
  DEFAULT_TIMEZONE,
  currentPeriod,
  formatDate,
  formatPeriod,
  isPeriodKey,
} from '@/lib/dates';
import { affiliateApi } from '@/lib/endpoints';
import { formatBps, formatMoney } from '@/lib/format';
import { commissionKind, commissionStatus } from '@/lib/labels';
import { useAffiliateHome } from '@/lib/useAffiliateHome';
import { errorMessage, useApi } from '@/lib/useApi';

const TZ = DEFAULT_TIMEZONE;

export function EarningsScreen({ initialPeriod }: { initialPeriod?: string }) {
  const i18n = useT();
  const { t, lang } = i18n;
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
      <PageHeader title={t('affiliate.earnings.title')} />

      <PeriodPicker period={period} onChange={setPeriod} maxPeriod={thisMonth} />

      {earnings.loading && !data ? <LoadingBlock /> : null}
      {earnings.error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={earnings.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(earnings.error, i18n)}
        </Alert>
      ) : null}

      {data ? (
        <>
          <Card>
            <p className="font-semibold text-muted">
              {t('affiliate.earnings.totalIn', { period: formatPeriod(data.periodKey, lang) })}
            </p>
            <p className="mt-1 text-4xl font-extrabold tracking-tight">
              <MoneyText amountMinor={data.totalMinor} currency={data.currency} lang={lang} />
            </p>
          </Card>

          <Card title={t('affiliate.earnings.entriesTitle')}>
            {data.entries.length === 0 ? (
              <p className="text-muted">
                {t('affiliate.earnings.noSales', { period: formatPeriod(data.periodKey, lang) })}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {data.entries.map((entry) => {
                  const status = commissionStatus(i18n, entry.status);
                  const negative = entry.amountMinor < 0;
                  return (
                    <li key={entry.id} className="flex flex-col gap-1.5 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold">{entry.productName}</p>
                          <p className="text-sm text-muted">
                            {entry.kind !== 'sale' ? `${commissionKind(i18n, entry.kind)} · ` : ''}
                            {t('affiliate.earnings.entryMeta', {
                              date: formatDate(entry.createdAt, TZ, lang),
                              reference: entry.bookingReference,
                            })}
                          </p>
                        </div>
                        <MoneyText
                          amountMinor={entry.amountMinor}
                          currency={data.currency}
                          lang={lang}
                          className={`text-lg font-bold ${negative ? 'text-danger-fg' : ''}`}
                        />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm text-muted">
                          {t('affiliate.earnings.rateOf', {
                            rate: formatBps(entry.rateBps, lang),
                            amount: formatMoney(entry.baseMinor, data.currency, lang),
                          })}
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

      <Card title={t('affiliate.earnings.howTitle')}>
        {plan ? (
          plan.kind === 'fixed' || plan.tiers.length <= 1 ? (
            <p>
              {t('affiliate.earnings.fixedBefore')}
              <strong>
                {formatBps(home.data?.progress.currentRateBps ?? plan.tiers[0]?.rateBps ?? 0, lang)}
              </strong>
              {t('affiliate.earnings.fixedAfter')}
            </p>
          ) : (
            <>
              <table className="w-full border-collapse text-left">
                <caption className="mb-2 text-left text-muted">
                  {t('affiliate.earnings.tierCaption')}
                </caption>
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="py-2 font-semibold">
                      {t('affiliate.earnings.salesInMonth')}
                    </th>
                    <th scope="col" className="py-2 text-right font-semibold">
                      {t('affiliate.earnings.commission')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tierRows(plan.tiers, i18n).map((row, i) => (
                    <tr
                      key={row.label}
                      className={`border-b border-line ${home.data?.progress.tierIndex === i ? 'font-semibold text-brand' : ''}`}
                    >
                      <th scope="row" className="py-2.5 font-normal">
                        {row.label}
                        {home.data?.progress.tierIndex === i ? (
                          <span className="ml-2 text-sm">{t('affiliate.earnings.now')}</span>
                        ) : null}
                      </th>
                      <td className="py-2.5 text-right tabular-nums">
                        {formatBps(row.rateBps, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.mode ? (
                <p className="mt-3 text-sm text-muted">{planModeExplanation(i18n, plan.mode)}</p>
              ) : null}
            </>
          )
        ) : (
          <p className="text-muted">{t('affiliate.earnings.planLoading')}</p>
        )}

        <dl className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          <div>
            <dt>
              <StatusChip tone={commissionStatus(i18n, 'pending').tone}>
                {commissionStatus(i18n, 'pending').label}
              </StatusChip>
            </dt>
            <dd className="mt-1 text-sm text-muted">{t('affiliate.earnings.pendingHelp')}</dd>
          </div>
          <div>
            <dt>
              <StatusChip tone={commissionStatus(i18n, 'approved').tone}>
                {commissionStatus(i18n, 'approved').label}
              </StatusChip>
            </dt>
            <dd className="mt-1 text-sm text-muted">{t('affiliate.earnings.approvedHelp')}</dd>
          </div>
          <div>
            <dt>
              <StatusChip tone={commissionStatus(i18n, 'paid').tone}>
                {commissionStatus(i18n, 'paid').label}
              </StatusChip>
            </dt>
            <dd className="mt-1 text-sm text-muted">{t('affiliate.earnings.paidHelp')}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-muted">{t('affiliate.earnings.refundNote')}</p>
      </Card>
    </div>
  );
}
