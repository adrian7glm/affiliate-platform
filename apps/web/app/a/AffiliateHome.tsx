'use client';

import type { AffiliateHomeDto } from '@ap/contracts';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/Alert';
import { useSession } from '@/components/AuthGate';
import { BookingItem } from '@/components/BookingItem';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EarningsChart } from '@/components/EarningsChart';
import {
  IconCalendarPlus,
  IconChevronRight,
  IconLink,
  IconLogout,
  IconPrinter,
  IconQr,
} from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { LoadingBlock } from '@/components/Spinner';
import { tierProgressFraction, tierProgressSentence, tierRows } from '@/lib/commission';
import { formatPeriod, greetingRo, todayKey } from '@/lib/dates';
import { formatBps, formatMoney } from '@/lib/format';
import { pluralRo } from '@/lib/i18n';
import {
  averageSaleMinor,
  bestPastMonth,
  daysLeftInPeriod,
  nextTierExtraMinor,
} from '@/lib/insights';
import { useAffiliateHome } from '@/lib/useAffiliateHome';
import { errorMessageRo } from '@/lib/useApi';

export function AffiliateHome() {
  const { me, membership, memberships, switchTenant, logout } = useSession();
  const home = useAffiliateHome();
  const data = home.data;
  const firstName = (data?.affiliate.displayName ?? me.user.name ?? '')
    .trim()
    .split(/[\s,(·-]+/)[0];
  const tz = data?.tenant.timezone;

  return (
    <div className="page-x mx-auto flex max-w-xl flex-col gap-4">
      <header className="flex items-start justify-between gap-3 pt-4">
        <div className="min-w-0">
          <p className="text-muted">{data?.tenant.name ?? membership.tenantName}</p>
          <h1 className="text-2xl font-bold">
            {greetingRo(new Date(), tz)}
            {firstName ? `, ${firstName}` : ''}!
          </h1>
        </div>
        <Button
          variant="ghost"
          icon={<IconLogout />}
          onClick={() => void logout()}
          className="shrink-0 px-3"
        >
          Ieși
        </Button>
      </header>

      {memberships.length > 1 ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Operator</span>
          <select
            className="field-input block min-h-12 w-full rounded-xl border-2 border-line-strong bg-surface px-3.5 text-fg"
            value={membership.tenantId}
            onChange={(e) => switchTenant(e.target.value)}
          >
            {memberships.map((m) => (
              <option key={m.tenantId} value={m.tenantId}>
                {m.tenantName}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {/* The two things a receptionist opens the app for, one tap away. */}
      <nav aria-label="Acțiuni rapide" className="grid grid-cols-2 gap-3">
        <Link
          href="/a/book"
          className="flex min-h-28 flex-col justify-between rounded-3xl bg-brand p-4 text-on-brand shadow-sm hover:bg-brand-strong"
        >
          <IconCalendarPlus size={32} />
          <span className="text-left text-lg font-bold leading-tight">
            Rezervă pentru un turist
          </span>
        </Link>
        <Link
          href="/a/qr"
          className="flex min-h-28 flex-col justify-between rounded-3xl border-2 border-line-strong bg-surface p-4 hover:bg-surface-2"
        >
          <IconQr size={32} />
          <span className="text-left text-lg font-bold leading-tight">Arată codul QR</span>
        </Link>
      </nav>

      {home.stale ? (
        <Alert tone="warning">Fără conexiune. Vezi ultimele date salvate pe telefon.</Alert>
      ) : null}
      {home.error && !data ? (
        <Alert
          tone="error"
          title="Nu am putut încărca datele"
          action={
            <Button variant="secondary" onClick={home.reload}>
              Încearcă din nou
            </Button>
          }
        >
          {errorMessageRo(home.error)}
        </Alert>
      ) : null}
      {!data && home.loading ? <LoadingBlock /> : null}

      {data ? <Dashboard data={data} /> : null}

      <div className="flex flex-col">
        <Link
          href="/a/kit"
          className="flex min-h-14 items-center justify-between gap-3 rounded-2xl px-1 font-semibold text-brand"
        >
          <span className="flex items-center gap-2">
            <IconPrinter />
            Kit QR de tipărit: afișe, cort de masă, cartonașe
          </span>
          <IconChevronRight />
        </Link>
        <Link
          href="/a/links"
          className="flex min-h-14 items-center justify-between gap-3 rounded-2xl px-1 font-semibold text-brand"
        >
          <span className="flex items-center gap-2">
            <IconLink />
            Linkurile mele și ce aduce fiecare
          </span>
          <IconChevronRight />
        </Link>
      </div>
    </div>
  );
}

function Dashboard({ data }: { data: AffiliateHomeDto }) {
  const currency = data.tenant.currency;
  const tz = data.tenant.timezone;
  // Payloads saved by an older version of the app have no history.
  const history = data.history ?? [];
  const current = history.at(-1);
  const previous = history.at(-2);
  const daysLeft = daysLeftInPeriod(data.periodKey, todayKey(tz));
  const tiered = data.plan.kind === 'tiered' && data.progress.tierCount > 1;
  const extra = nextTierExtraMinor(data.progress, averageSaleMinor(history));
  const best = bestPastMonth(history);
  const sales = data.progress.paidSales;
  const [showAll, setShowAll] = useState(false);

  return (
    <>
      {data.affiliate.status === 'suspended' ? (
        <Alert tone="warning" title="Cont suspendat">
          Operatorul a suspendat temporar contul tău. Linkurile și rezervările noi nu mai aduc
          comision.
        </Alert>
      ) : null}

      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-semibold text-muted">Câștigul tău în {formatPeriod(data.periodKey)}</p>
          {daysLeft > 0 ? (
            <p className="shrink-0 text-sm text-muted">
              {daysLeft === 1 ? 'ultima zi' : `încă ${daysLeft} zile`}
            </p>
          ) : null}
        </div>
        <p className="mt-1 text-5xl font-extrabold tracking-tight">
          <MoneyText amountMinor={data.earnings.monthTotalMinor} currency={currency} />
        </p>
        <p className="mt-1 text-muted">
          {sales === 0
            ? 'Nicio vânzare plătită încă luna aceasta.'
            : `${pluralRo(sales, 'vânzare plătită', 'vânzări plătite')}${
                current && current.salesMinor > 0
                  ? `, în valoare de ${formatMoney(current.salesMinor, currency)}`
                  : ''
              }`}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl bg-surface-2 p-3">
            <dt className="text-muted">În așteptare</dt>
            <dd className="text-base font-semibold">
              <MoneyText amountMinor={data.earnings.pendingMinor} currency={currency} />
            </dd>
            <dd className="text-xs text-muted">excursia nu a avut loc</dd>
          </div>
          <div className="rounded-2xl bg-surface-2 p-3">
            <dt className="text-muted">Aprobat</dt>
            <dd className="text-base font-semibold">
              <MoneyText amountMinor={data.earnings.approvedMinor} currency={currency} />
            </dd>
            <dd className="text-xs text-muted">turistul a mers</dd>
          </div>
        </dl>
        {data.earnings.payableMinor > 0 ? (
          <p className="mt-3 rounded-2xl bg-success-soft p-3 text-sm text-success-fg">
            De încasat de la operator:{' '}
            <MoneyText
              amountMinor={data.earnings.payableMinor}
              currency={currency}
              className="font-bold"
            />
          </p>
        ) : null}
      </Card>

      <Card title={tiered ? 'Nivelul tău de comision' : 'Comisionul tău'}>
        <p className="text-lg font-semibold" id="tier-progress-label">
          {tierProgressSentence(data.progress, data.plan.kind)}
        </p>
        {tiered ? (
          <>
            <progress
              className="progress-bar mt-3"
              max={100}
              value={Math.round(tierProgressFraction(data.progress, data.plan.tiers) * 100)}
              aria-labelledby="tier-progress-label"
            />
            {extra !== null ? (
              <p className="mt-2 text-sm">
                La {formatBps(data.progress.nextRateBps!)}, o rezervare obișnuită îți aduce cu{' '}
                <strong>{formatMoney(extra, currency)}</strong> mai mult.
              </p>
            ) : null}
            <ol
              className="mt-4 grid gap-2"
              style={{ gridTemplateColumns: `repeat(${data.plan.tiers.length}, minmax(0, 1fr))` }}
            >
              {tierRows(data.plan.tiers).map((row, i) => {
                const state =
                  i === data.progress.tierIndex
                    ? 'current'
                    : i < data.progress.tierIndex
                      ? 'done'
                      : 'next';
                return (
                  <li
                    key={row.label}
                    aria-current={state === 'current' ? 'step' : undefined}
                    className={`flex flex-col items-center rounded-2xl border-2 px-1 py-2 text-center ${
                      state === 'current'
                        ? 'border-brand bg-brand text-on-brand'
                        : state === 'done'
                          ? 'border-transparent bg-brand-soft text-brand-soft-fg'
                          : 'border-line text-muted'
                    }`}
                  >
                    <span className="text-xl font-extrabold tabular-nums">
                      {formatBps(row.rateBps)}
                    </span>
                    <span className="text-xs leading-tight">
                      {tierShortLabel(data.plan.tiers, i)}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 text-sm text-muted">
              Nivelul pornește de la zero pe 1 ale fiecărei luni.
            </p>
          </>
        ) : null}
      </Card>

      {history.length > 1 ? (
        <Card
          title="Ultimele luni"
          action={
            <Link
              href="/a/earnings"
              className="inline-flex min-h-12 items-center font-semibold text-brand"
            >
              Detalii
            </Link>
          }
        >
          <EarningsChart history={history} currency={currency} />
          {previous ? (
            <p className="mt-3 text-sm text-muted">
              Luna trecută: {formatMoney(previous.commissionMinor, currency)} din{' '}
              {pluralRo(previous.paidSales, 'vânzare', 'vânzări')}.
              {best && best.periodKey !== previous.periodKey
                ? ` Cea mai bună lună: ${formatPeriod(best.periodKey)}, ${formatMoney(best.commissionMinor, currency)}.`
                : ''}
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card
        title="Rezervări recente"
        action={
          <Link
            href="/a/book"
            className="inline-flex min-h-12 items-center font-semibold text-brand"
          >
            Rezervă
          </Link>
        }
      >
        {data.recentBookings.length === 0 ? (
          <p className="text-muted">
            Încă nu ai rezervări. Arată codul QR turiștilor sau rezervă direct pentru ei.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {data.recentBookings.slice(0, showAll ? undefined : 5).map((booking) => (
              <li key={booking.id}>
                <BookingItem booking={booking} timezone={tz} />
              </li>
            ))}
          </ul>
        )}
        {!showAll && data.recentBookings.length > 5 ? (
          <Button variant="ghost" block onClick={() => setShowAll(true)} className="mt-1">
            Arată toate cele {data.recentBookings.length}
          </Button>
        ) : null}
      </Card>
    </>
  );
}

/** "1–3", "4–10", "11+" for the tier ladder. */
function tierShortLabel(tiers: { fromSale: number }[], index: number): string {
  const sorted = [...tiers].sort((a, b) => a.fromSale - b.fromSale);
  const tier = sorted[index]!;
  const next = sorted[index + 1];
  if (!next) return `${tier.fromSale}+ vânzări`;
  if (next.fromSale - 1 === tier.fromSale) return `vânzarea ${tier.fromSale}`;
  return `${tier.fromSale}–${next.fromSale - 1} vânzări`;
}
