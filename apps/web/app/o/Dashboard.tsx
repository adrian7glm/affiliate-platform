'use client';

import type { OperatorAnalyticsDto } from '@ap/contracts';
import { useRef, useState, type ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { ChannelBars } from '@/components/charts/ChannelBars';
import { DailySalesChart } from '@/components/charts/DailySalesChart';
import { IconPlus, IconScan } from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { PeriodPicker } from '@/components/PeriodPicker';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { percentChange, share, tierRatio } from '@/lib/analytics';
import { currentPeriod, formatPeriod } from '@/lib/dates';
import { operatorApi } from '@/lib/endpoints';
import { formatBps } from '@/lib/format';
import { pluralRo } from '@/lib/i18n';
import { COMMISSION_STATUS } from '@/lib/labels';
import { errorMessageRo, useApi } from '@/lib/useApi';
import { useOperator } from './OperatorContext';

type Analytics = OperatorAnalyticsDto;
type AffiliateRow = Analytics['affiliates'][number];

/** How many affiliates the list shows before "show all". */
const AFFILIATES_SHOWN = 8;

export function Dashboard() {
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
        title="Panou"
        actions={
          <>
            <ButtonLink href="/o/scan" icon={<IconScan />}>
              Scanează bilete
            </ButtonLink>
            <ButtonLink href="/o/affiliates#invite" variant="secondary" icon={<IconPlus />}>
              Invită afiliat
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
              Încearcă din nou
            </Button>
          }
        >
          {errorMessageRo(analytics.error)}
        </Alert>
      ) : null}

      {data ? (
        <div
          className={`flex flex-col gap-5 transition-opacity ${stale ? 'opacity-50' : ''}`}
          aria-busy={stale}
        >
          <Kpis data={data} />

          <Card
            title="Vânzări pe zile"
            description="Încasări din rezervările plătite, în ziua plății"
          >
            <DailySalesChart
              daily={data.daily}
              throughDate={data.throughDate}
              currency={data.currency}
              summaryTitle={
                data.throughDate.slice(0, 7) === thisMonth
                  ? 'Luna aceasta, până azi'
                  : `Toată luna ${formatPeriod(data.periodKey)}`
              }
            />
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="De unde vin rezervările" description="Încasări pe canal de vânzare">
              <ChannelBars channels={data.channels} currency={data.currency} />
            </Card>
            <CommissionsCard data={data} />
          </div>

          <AffiliatesCard data={data} />

          <Card title="Pagina publică de rezervări">
            <p className="text-muted">
              Turiștii fără afiliat rezervă aici. Linkurile afiliaților duc tot aici, cu atribuire.
            </p>
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
  const change = percentChange(current, previous);
  // A finished month is compared with the whole previous month, the current one day for day.
  const fullMonth = data.daily.length === Number(data.throughDate.slice(8));
  const prevName = formatPeriod(data.previous.periodKey).split(' ')[0];
  const against = fullMonth ? prevName : `1–${data.previous.throughDay} ${prevName}`;
  if (change === null) {
    return <>Nicio vânzare în {against}</>;
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
      față de {against}
    </span>
  );
}

function Kpis({ data }: { data: Analytics }) {
  const { totals, commissions, currency } = data;
  return (
    <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Stat
        label="Încasări"
        value={<MoneyText amountMinor={totals.revenueMinor} currency={currency} />}
        hint={
          <Change current={totals.revenueMinor} previous={data.previous.revenueMinor} data={data} />
        }
      />
      <Stat
        label="Rezervări"
        value={totals.bookings}
        hint={<Change current={totals.bookings} previous={data.previous.bookings} data={data} />}
      />
      <Stat
        label="Prin afiliați"
        value={`${share(totals.affiliateRevenueMinor, totals.revenueMinor)}%`}
        hint={
          <>
            <MoneyText amountMinor={totals.affiliateRevenueMinor} currency={currency} /> din{' '}
            {pluralRo(totals.affiliateBookings, 'rezervare', 'rezervări')}
            {totals.clicks > 0
              ? ` · ${pluralRo(totals.clicks, 'vizită', 'vizite')} din QR și linkuri`
              : ''}
          </>
        }
      />
      <Stat
        label="De plătit afiliaților"
        value={<MoneyText amountMinor={commissions.payableMinor} currency={currency} />}
        hint={
          commissions.pendingMinor > 0 ? (
            <>
              încă <MoneyText amountMinor={commissions.pendingMinor} currency={currency} /> după
              excursiile din luna aceasta
            </>
          ) : (
            'Aprobat și neplătit încă'
          )
        }
      />
    </dl>
  );
}

// ------------------------------------------------------------------------------------------------
// Commissions owed
// ------------------------------------------------------------------------------------------------

function CommissionsCard({ data }: { data: Analytics }) {
  const { commissions, currency } = data;
  const rows = [
    {
      status: 'pending' as const,
      amount: commissions.pendingMinor,
      hint: 'Excursia nu a avut loc încă',
    },
    {
      status: 'approved' as const,
      amount: commissions.approvedMinor,
      hint: 'Turistul s-a îmbarcat; intră la plată',
    },
    { status: 'paid' as const, amount: commissions.paidMinor, hint: 'Plătit afiliaților' },
  ];
  return (
    <Card
      title="Comisioane"
      description={`Câștigate de afiliați în ${formatPeriod(data.periodKey)}`}
    >
      <p className="text-3xl font-extrabold tracking-tight">
        <MoneyText amountMinor={commissions.totalMinor} currency={currency} />
      </p>
      <ul className="mt-3 flex flex-col divide-y divide-line">
        {rows.map((r) => (
          <li key={r.status} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <StatusChip tone={COMMISSION_STATUS[r.status].tone}>
                {COMMISSION_STATUS[r.status].label}
              </StatusChip>
              <p className="mt-1 text-sm text-muted">{r.hint}</p>
            </div>
            <MoneyText amountMinor={r.amount} currency={currency} className="font-semibold" />
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-2 p-3">
        <div>
          <p className="text-sm font-semibold text-muted">De plătit acum, din toate lunile</p>
          <p className="text-xl font-bold">
            <MoneyText amountMinor={commissions.payableMinor} currency={currency} />
          </p>
        </div>
        <ButtonLink href="/o/payouts" variant="secondary">
          Vezi plățile
        </ButtonLink>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------
// Affiliates and their tiers
// ------------------------------------------------------------------------------------------------

function tierText(a: AffiliateRow): { now: string; next: string | null } {
  const p = a.progress;
  if (a.planKind === null) return { now: 'Fără plan de comision', next: null };
  if (a.planKind === 'fixed')
    return { now: `Comision fix ${formatBps(p.currentRateBps)}`, next: null };
  const now = `Treapta ${p.tierIndex + 1} din ${p.tierCount} · ${formatBps(p.currentRateBps)}`;
  if (p.salesToNextTier === null || p.nextRateBps === null) {
    return { now, next: 'A atins treapta maximă' };
  }
  return {
    now,
    next: `Încă ${pluralRo(p.salesToNextTier, 'vânzare', 'vânzări')} până la ${formatBps(p.nextRateBps)}`,
  };
}

function AffiliateItem({ a, currency }: { a: AffiliateRow; currency: string }) {
  const tier = tierText(a);
  const ratio = tierRatio(a.progress);
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 font-semibold">
          {a.name}
          {a.status === 'suspended' ? (
            <span className="ml-2 align-middle">
              <StatusChip tone="neutral">Suspendat</StatusChip>
            </span>
          ) : null}
        </p>
        <MoneyText amountMinor={a.salesMinor} currency={currency} className="font-semibold" />
      </div>
      <p className="text-sm text-muted">
        {pluralRo(a.paidSales, 'vânzare', 'vânzări')}
        {a.clicks > 0 ? ` din ${pluralRo(a.clicks, 'vizită', 'vizite')}` : ''} · comision{' '}
        <MoneyText amountMinor={a.commissionMinor} currency={currency} />
        {a.payableMinor > 0 ? (
          <>
            {' '}
            · de plătit <MoneyText amountMinor={a.payableMinor} currency={currency} />
          </>
        ) : null}
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
  const [showAll, setShowAll] = useState(false);
  const list = data.affiliates;
  const shown = showAll ? list : list.slice(0, AFFILIATES_SHOWN);
  return (
    <Card
      title="Afiliații tăi"
      description="Vânzările lunii și cât mai au până la următorul procent"
      action={
        <ButtonLink href="/o/affiliates" variant="ghost">
          Toți afiliații
        </ButtonLink>
      }
    >
      {list.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-muted">
            Încă nu ai afiliați activi. Invită recepționerii hotelurilor partenere: primesc un cod
            QR și un link, iar vânzările lor apar aici.
          </p>
          <ButtonLink href="/o/affiliates#invite" icon={<IconPlus />}>
            Invită afiliat
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
              {showAll ? 'Arată mai puțini' : `Arată toți (${list.length})`}
            </Button>
          ) : null}
        </>
      )}
    </Card>
  );
}
