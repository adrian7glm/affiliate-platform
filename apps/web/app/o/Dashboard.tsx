'use client';

import type { OperatorAnalyticsDto } from '@ap/contracts';
import { useRef, useState, type ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { ChannelBars } from '@/components/charts/ChannelBars';
import { DailySalesChart } from '@/components/charts/DailySalesChart';
import { useT } from '@/components/I18nProvider';
import { IconPlus, IconScan } from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { PeriodPicker } from '@/components/PeriodPicker';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { percentChange, share, tierRatio } from '@/lib/analytics';
import { currentPeriod, formatPeriod } from '@/lib/dates';
import { operatorApi } from '@/lib/endpoints';
import { formatBps, formatMoney } from '@/lib/format';
import type { Translator } from '@/lib/i18n';
import { affiliateStatus, commissionStatus } from '@/lib/labels';
import { errorMessage, useApi } from '@/lib/useApi';
import { useOperator } from './OperatorContext';

type Analytics = OperatorAnalyticsDto;
type AffiliateRow = Analytics['affiliates'][number];

/** How many affiliates the list shows before "show all". */
const AFFILIATES_SHOWN = 8;

export function Dashboard() {
  const tr = useT();
  const { t, lang } = tr;
  const { tenant } = useOperator();
  const thisMonth = currentPeriod(tenant.timezone);
  const [period, setPeriod] = useState(thisMonth);
  const analytics = useApi(`operator-analytics:${tenant.id}:${period}`, (signal) =>
    operatorApi.analytics(period, { signal }),
  );

  // While another month loads, keep the previous one on screen (dimmed) instead of a blank page.
  const last = useRef<{ tenantId: string; data: Analytics } | null>(null);
  if (analytics.data) last.current = { tenantId: tenant.id, data: analytics.data };
  const data = analytics.data ?? (last.current?.tenantId === tenant.id ? last.current.data : null);
  const stale = !analytics.data && !!data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('operator.dashboard.title')}
        actions={
          <>
            <ButtonLink href="/o/scan" icon={<IconScan />}>
              {t('operator.dashboard.scan')}
            </ButtonLink>
            <ButtonLink href="/o/affiliates#invite" variant="secondary" icon={<IconPlus />}>
              {t('operator.dashboard.invite')}
            </ButtonLink>
          </>
        }
      />

      <div className="max-w-md">
        <PeriodPicker period={period} onChange={setPeriod} maxPeriod={thisMonth} />
      </div>

      {analytics.loading && !data ? <LoadingBlock /> : null}
      {analytics.error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={analytics.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(analytics.error, tr)}
        </Alert>
      ) : null}

      {data ? (
        <div
          className={`flex flex-col gap-5 transition-opacity ${stale ? 'opacity-50' : ''}`}
          aria-busy={stale}
        >
          <Kpis data={data} />

          <Card
            title={t('operator.dashboard.dailyTitle')}
            description={t('operator.dashboard.dailyDescription')}
          >
            <DailySalesChart
              daily={data.daily}
              throughDate={data.throughDate}
              currency={data.currency}
              summaryTitle={
                data.throughDate.slice(0, 7) === thisMonth
                  ? t('operator.dashboard.thisMonthSoFar')
                  : t('operator.dashboard.wholeMonth', {
                      month: formatPeriod(data.periodKey, lang),
                    })
              }
            />
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card
              title={t('operator.dashboard.channelsTitle')}
              description={t('operator.dashboard.channelsDescription')}
            >
              <ChannelBars channels={data.channels} currency={data.currency} />
            </Card>
            <CommissionsCard data={data} />
          </div>

          <AffiliatesCard data={data} />

          <Card title={t('operator.dashboard.publicPageTitle')}>
            <p className="text-muted">{t('operator.dashboard.publicPageText')}</p>
            <a
              href={`/b/${tenant.slug}`}
              className="mt-2 inline-flex min-h-12 items-center break-all font-semibold text-brand underline"
              target="_blank"
              rel="noopener"
            >
              {typeof window !== 'undefined' ? window.location.origin : ''}/b/{tenant.slug}
            </a>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Headline numbers
// ------------------------------------------------------------------------------------------------

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-3xl border border-line bg-surface p-3 sm:p-5">
      <dt className="text-sm font-semibold text-muted sm:text-base">{label}</dt>
      <dd className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{value}</dd>
      {hint ? <dd className="mt-1 text-sm text-muted">{hint}</dd> : null}
    </div>
  );
}

/** "+12% față de 1–12 septembrie", with an arrow so the direction never relies on colour. */
function Change({
  current,
  previous,
  data,
}: {
  current: number;
  previous: number;
  data: Analytics;
}) {
  const { t, lang } = useT();
  const change = percentChange(current, previous);
  // A finished month is compared with the whole previous month, the current one day for day.
  const fullMonth = data.daily.length === Number(data.throughDate.slice(8));
  const prevName = formatPeriod(data.previous.periodKey, lang).split(' ')[0] ?? '';
  const against = fullMonth
    ? prevName
    : t('operator.dashboard.dayRange', { day: data.previous.throughDay, month: prevName });
  if (change === null) {
    return <>{t('operator.dashboard.noSalesIn', { period: against })}</>;
  }
  const up = change > 0;
  const flat = change === 0;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span
        className={`inline-flex items-center gap-0.5 font-semibold ${
          flat ? 'text-fg' : up ? 'text-success-fg' : 'text-danger-fg'
        }`}
      >
        {flat ? null : (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path
              d={up ? 'M6 2v8M2.5 5.5 6 2l3.5 3.5' : 'M6 10V2M2.5 6.5 6 10l3.5-3.5'}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {up ? '+' : ''}
        {change}%
      </span>
      {t('operator.dashboard.comparedWith', { period: against })}
    </span>
  );
}

function Kpis({ data }: { data: Analytics }) {
  const { t, tp, lang } = useT();
  const { totals, commissions, currency } = data;
  const money = (minor: number) => formatMoney(minor, currency, lang);
  return (
    <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Stat
        label={t('operator.dashboard.revenue')}
        value={<MoneyText amountMinor={totals.revenueMinor} currency={currency} />}
        hint={
          <Change current={totals.revenueMinor} previous={data.previous.revenueMinor} data={data} />
        }
      />
      <Stat
        label={t('operator.dashboard.bookings')}
        value={totals.bookings}
        hint={<Change current={totals.bookings} previous={data.previous.bookings} data={data} />}
      />
      <Stat
        label={t('operator.dashboard.viaAffiliates')}
        value={`${share(totals.affiliateRevenueMinor, totals.revenueMinor)}%`}
        hint={
          <>
            {tp('operator.dashboard.affiliateBookings', totals.affiliateBookings, {
              amount: money(totals.affiliateRevenueMinor),
            })}
            {totals.clicks > 0
              ? ` · ${tp('operator.dashboard.affiliateVisits', totals.clicks)}`
              : ''}
          </>
        }
      />
      <Stat
        label={t('operator.dashboard.payable')}
        value={<MoneyText amountMinor={commissions.payableMinor} currency={currency} />}
        hint={
          commissions.pendingMinor > 0
            ? t('operator.dashboard.pendingAfterTrips', { amount: money(commissions.pendingMinor) })
            : t('operator.dashboard.approvedUnpaid')
        }
      />
    </dl>
  );
}

// ------------------------------------------------------------------------------------------------
// Commissions owed
// ------------------------------------------------------------------------------------------------

function CommissionsCard({ data }: { data: Analytics }) {
  const tr = useT();
  const { t, lang } = tr;
  const { commissions, currency } = data;
  const rows = [
    {
      status: 'pending' as const,
      amount: commissions.pendingMinor,
      hint: t('operator.dashboard.pendingHint'),
    },
    {
      status: 'approved' as const,
      amount: commissions.approvedMinor,
      hint: t('operator.dashboard.approvedHint'),
    },
    {
      status: 'paid' as const,
      amount: commissions.paidMinor,
      hint: t('operator.dashboard.paidHint'),
    },
  ];
  return (
    <Card
      title={t('operator.dashboard.commissionsTitle')}
      description={t('operator.dashboard.commissionsDescription', {
        period: formatPeriod(data.periodKey, lang),
      })}
    >
      <p className="text-3xl font-extrabold tracking-tight">
        <MoneyText amountMinor={commissions.totalMinor} currency={currency} />
      </p>
      <ul className="mt-3 flex flex-col divide-y divide-line">
        {rows.map((r) => (
          <li key={r.status} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <StatusChip tone={commissionStatus(tr, r.status).tone}>
                {commissionStatus(tr, r.status).label}
              </StatusChip>
              <p className="mt-1 text-sm text-muted">{r.hint}</p>
            </div>
            <MoneyText amountMinor={r.amount} currency={currency} className="font-semibold" />
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-2 p-3">
        <div>
          <p className="text-sm font-semibold text-muted">{t('operator.dashboard.payableNow')}</p>
          <p className="text-xl font-bold">
            <MoneyText amountMinor={commissions.payableMinor} currency={currency} />
          </p>
        </div>
        <ButtonLink href="/o/payouts" variant="secondary">
          {t('operator.dashboard.seePayouts')}
        </ButtonLink>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------
// Affiliates and their tiers
// ------------------------------------------------------------------------------------------------

function tierText(a: AffiliateRow, tr: Translator): { now: string; next: string | null } {
  const { t, tp, lang } = tr;
  const p = a.progress;
  if (a.planKind === null) return { now: t('operator.dashboard.noPlan'), next: null };
  if (a.planKind === 'fixed')
    return {
      now: t('operator.dashboard.fixedRate', { rate: formatBps(p.currentRateBps, lang) }),
      next: null,
    };
  const now = t('operator.dashboard.tierLevel', {
    level: p.tierIndex + 1,
    total: p.tierCount,
    rate: formatBps(p.currentRateBps, lang),
  });
  if (p.salesToNextTier === null || p.nextRateBps === null) {
    return { now, next: t('operator.dashboard.topTier') };
  }
  return {
    now,
    next: tp('operator.dashboard.salesToNext', p.salesToNextTier, {
      rate: formatBps(p.nextRateBps, lang),
    }),
  };
}

function AffiliateItem({ a, currency }: { a: AffiliateRow; currency: string }) {
  const tr = useT();
  const { t, tp, lang } = tr;
  const money = (minor: number) => formatMoney(minor, currency, lang);
  const tier = tierText(a, tr);
  const sales =
    a.clicks > 0
      ? tp('operator.dashboard.salesFromVisits', a.paidSales, {
          visits: tp('operator.dashboard.visits', a.clicks),
        })
      : tp('operator.dashboard.sales', a.paidSales);
  const ratio = tierRatio(a.progress);
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 font-semibold">
          {a.name}
          {a.status === 'suspended' ? (
            <span className="ml-2 align-middle">
              <StatusChip tone="neutral">{affiliateStatus(tr, 'suspended').label}</StatusChip>
            </span>
          ) : null}
        </p>
        <MoneyText amountMinor={a.salesMinor} currency={currency} className="font-semibold" />
      </div>
      <p className="text-sm text-muted">
        {sales} · {t('operator.dashboard.commission', { amount: money(a.commissionMinor) })}
        {a.payableMinor > 0
          ? ` · ${t('operator.dashboard.toPay', { amount: money(a.payableMinor) })}`
          : null}
      </p>
      {a.planKind === 'tiered' ? (
        <div className="mt-2">
          <progress
            className="progress-bar"
            max={1}
            value={ratio}
            aria-label={`${a.name}: ${tier.now}. ${tier.next ?? ''}`}
          />
          <p className="mt-1 flex flex-wrap justify-between gap-x-3 text-sm">
            <span className="font-semibold">{tier.now}</span>
            {tier.next ? <span className="text-muted">{tier.next}</span> : null}
          </p>
        </div>
      ) : (
        <p className="mt-1 text-sm font-semibold">{tier.now}</p>
      )}
    </li>
  );
}

function AffiliatesCard({ data }: { data: Analytics }) {
  const { t } = useT();
  const [showAll, setShowAll] = useState(false);
  const list = data.affiliates;
  const shown = showAll ? list : list.slice(0, AFFILIATES_SHOWN);
  return (
    <Card
      title={t('operator.dashboard.affiliatesTitle')}
      description={t('operator.dashboard.affiliatesDescription')}
      action={
        <ButtonLink href="/o/affiliates" variant="ghost">
          {t('operator.dashboard.allAffiliates')}
        </ButtonLink>
      }
    >
      {list.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-muted">{t('operator.dashboard.noAffiliates')}</p>
          <ButtonLink href="/o/affiliates#invite" icon={<IconPlus />}>
            {t('operator.dashboard.invite')}
          </ButtonLink>
        </div>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-line">
            {shown.map((a) => (
              <AffiliateItem key={a.affiliateId} a={a} currency={data.currency} />
            ))}
          </ul>
          {list.length > AFFILIATES_SHOWN ? (
            <Button variant="ghost" className="mt-2 -ml-3" onClick={() => setShowAll((v) => !v)}>
              {showAll
                ? t('operator.dashboard.showFewer')
                : t('operator.dashboard.showAll', { total: list.length })}
            </Button>
          ) : null}
        </>
      )}
    </Card>
  );
}
