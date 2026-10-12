'use client';

import type { AdminTenantRowDto, AdminOverviewDto } from '@ap/contracts';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { IconChevronRight, IconPlus } from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { PeriodPicker } from '@/components/PeriodPicker';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { currentPeriod, formatDate, formatPeriod } from '@/lib/dates';
import { formatBps } from '@/lib/format';
import { pluralRo } from '@/lib/i18n';
import { adminApi } from '@/lib/platform-endpoints';
import { SUBSCRIPTION_STATUS, TENANT_STATUS } from '@/lib/platform-labels';
import { errorMessageRo, useApi } from '@/lib/useApi';

const PLATFORM_TZ = 'Europe/Bucharest';

type Filter = 'all' | 'paying' | 'trial' | 'past_due' | 'suspended';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Toți' },
  { value: 'paying', label: 'Plătesc' },
  { value: 'trial', label: 'În probă' },
  { value: 'past_due', label: 'Restanțe' },
  { value: 'suspended', label: 'Suspendați' },
];

function matches(row: AdminTenantRowDto, filter: Filter): boolean {
  const s = row.subscription?.status;
  switch (filter) {
    case 'all':
      return true;
    case 'paying':
      return row.status === 'active' && s === 'active';
    case 'trial':
      return row.status === 'active' && s === 'trialing';
    case 'past_due':
      return row.status === 'active' && s === 'past_due';
    case 'suspended':
      return row.status === 'suspended';
  }
}

export function AdminOverview() {
  const thisMonth = currentPeriod(PLATFORM_TZ);
  const [period, setPeriod] = useState(thisMonth);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const overview = useApi(`admin-overview:${period}`, (signal) =>
    adminApi.overview(period, { signal }),
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (overview.data?.tenants ?? []).filter(
      (r) =>
        matches(r, filter) &&
        (!q ||
          r.name.toLowerCase().includes(q) ||
          r.slug.includes(q) ||
          (r.ownerEmail ?? '').includes(q)),
    );
  }, [overview.data, filter, query]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Operatori"
        description="Toți operatorii de pe platformă, cu abonamentul și ce au vândut în luna aleasă."
        actions={
          <ButtonLink href="/admin/invites" icon={<IconPlus />}>
            Invită un operator
          </ButtonLink>
        }
      />

      <div className="max-w-md">
        <PeriodPicker period={period} onChange={setPeriod} maxPeriod={thisMonth} />
      </div>

      {overview.error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={overview.reload}>
              Încearcă din nou
            </Button>
          }
        >
          {errorMessageRo(overview.error)}
        </Alert>
      ) : null}
      {overview.loading && !overview.data ? <LoadingBlock /> : null}
      {overview.data ? <Kpis data={overview.data} /> : null}

      {overview.data ? (
        <Card
          title={`Operatori · ${formatPeriod(period)}`}
          description="Rezervările, valoarea și comisionul platformei sunt pentru luna aleasă."
        >
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div
              role="group"
              aria-label="Filtrează după stare"
              className="flex gap-2 overflow-x-auto pb-1"
            >
              {FILTERS.map((f) => {
                const count = overview.data!.tenants.filter((r) => matches(r, f.value)).length;
                return (
                  <button
                    key={f.value}
                    type="button"
                    aria-pressed={filter === f.value}
                    onClick={() => setFilter(f.value)}
                    className={`min-h-11 shrink-0 rounded-full border-2 px-4 font-semibold ${
                      filter === f.value
                        ? 'border-brand bg-brand text-on-brand'
                        : 'border-line-strong bg-surface text-fg hover:bg-surface-2'
                    }`}
                  >
                    {f.label} <span className="tabular-nums opacity-80">{count}</span>
                  </button>
                );
              })}
            </div>
            <label className="md:w-72">
              <span className="visually-hidden">Caută operator</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Caută după nume sau email"
                className="field-input block min-h-12 w-full rounded-xl border-2 border-line-strong bg-surface px-3 text-fg"
              />
            </label>
          </div>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-muted">
              {overview.data.tenants.length === 0
                ? 'Niciun operator încă. Trimite prima invitație.'
                : 'Niciun operator nu se potrivește.'}
            </p>
          ) : (
            <TenantList rows={rows} />
          )}
        </Card>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-3xl border border-line bg-surface p-4">
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

function MoneyList({ items }: { items: { amountMinor: number; currency: string }[] }) {
  if (items.length === 0) return <>0</>;
  return (
    <span className="flex flex-col">
      {items.map((m) => (
        <MoneyText key={m.currency} amountMinor={m.amountMinor} currency={m.currency} />
      ))}
    </span>
  );
}

function Kpis({ data }: { data: AdminOverviewDto }) {
  const { operators } = data;
  return (
    <section aria-label="Cifre cheie" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi
        label="Venit lunar din abonamente"
        value={<MoneyList items={data.mrr} />}
        hint={pluralRo(operators.active, 'operator plătește', 'operatori plătesc')}
      />
      <Kpi
        label="Comision platformă"
        value={
          <MoneyList
            items={data.volume.map((v) => ({
              amountMinor: v.platformFeesMinor,
              currency: v.currency,
            }))}
          />
        }
        hint={`din ${pluralRo(
          data.volume.reduce((n, v) => n + v.bookings, 0),
          'rezervare',
          'rezervări',
        )}`}
      />
      <Kpi
        label="Valoare rezervări"
        value={
          <MoneyList
            items={data.volume.map((v) => ({ amountMinor: v.grossMinor, currency: v.currency }))}
          />
        }
        hint="vândută de operatori"
      />
      <Kpi
        label="Operatori"
        value={operators.total}
        hint={[
          `${operators.trialing} în probă`,
          operators.pastDue ? `${operators.pastDue} restanțe` : null,
          operators.suspended ? `${operators.suspended} suspendați` : null,
          data.newOperators ? `${data.newOperators} noi` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
    </section>
  );
}

function SubscriptionChip({ row }: { row: AdminTenantRowDto }) {
  if (row.status === 'suspended') {
    return (
      <StatusChip tone={TENANT_STATUS.suspended.tone}>{TENANT_STATUS.suspended.label}</StatusChip>
    );
  }
  if (!row.subscription) return <StatusChip>Fără abonament</StatusChip>;
  const s = SUBSCRIPTION_STATUS[row.subscription.status];
  return <StatusChip tone={s.tone}>{s.label}</StatusChip>;
}

function TenantList({ rows }: { rows: AdminTenantRowDto[] }) {
  return (
    <>
      {/* Phones: one card per operator */}
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/admin/operators/${row.id}`}
              className="flex items-center gap-3 rounded-2xl border border-line p-3 hover:bg-surface-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{row.name}</p>
                <p className="truncate text-sm text-muted">
                  {row.subscription?.planName ?? 'Fără plan'} ·{' '}
                  {pluralRo(row.affiliates, 'afiliat', 'afiliați')} ·{' '}
                  {pluralRo(row.bookings, 'rezervare', 'rezervări')}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <SubscriptionChip row={row} />
                  <MoneyText
                    amountMinor={row.platformFeesMinor}
                    currency={row.currency}
                    className="text-sm font-semibold"
                  />
                </div>
              </div>
              <IconChevronRight className="shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>

      {/* Tablets and desktop: a table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left">
          <thead className="text-sm text-muted">
            <tr className="border-b border-line">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Operator
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Abonament
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Afiliați
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Rezervări
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Valoare
              </th>
              <th scope="col" className="py-2 pl-3 text-right font-semibold">
                Comision platformă
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                <td className="py-3 pr-3">
                  <Link
                    href={`/admin/operators/${row.id}`}
                    className="font-semibold text-brand hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p className="text-sm text-muted">
                    {row.ownerEmail ?? row.slug}
                    {row.lastBookingAt
                      ? ` · ultima rezervare ${formatDate(row.lastBookingAt, PLATFORM_TZ)}`
                      : ' · nicio rezervare'}
                  </p>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <SubscriptionChip row={row} />
                    {row.subscription ? (
                      <span className="text-sm text-muted">
                        {row.subscription.planName} · {formatBps(row.subscription.platformFeeBps)} /
                        rezervare
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{row.affiliates}</td>
                <td className="px-3 py-3 text-right tabular-nums">{row.bookings}</td>
                <td className="px-3 py-3 text-right">
                  <MoneyText amountMinor={row.grossMinor} currency={row.currency} />
                </td>
                <td className="py-3 pl-3 text-right font-semibold">
                  <MoneyText amountMinor={row.platformFeesMinor} currency={row.currency} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
