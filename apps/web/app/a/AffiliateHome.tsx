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
import { useT } from '@/components/I18nProvider';
import {
  IconCalendarPlus,
  IconChevronRight,
  IconLink,
  IconLogout,
  IconPrinter,
  IconQr,
  IconShield,
} from '@/components/icons';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { MoneyText } from '@/components/MoneyText';
import { LoadingBlock } from '@/components/Spinner';
import { tierProgressFraction, tierProgressSentence, tierRows } from '@/lib/commission';
import { formatPeriod, greetingKey, todayKey } from '@/lib/dates';
import { formatBps, formatMoney } from '@/lib/format';
import type { Translator } from '@/lib/i18n';
import {
  averageSaleMinor,
  bestPastMonth,
  daysLeftInPeriod,
  nextTierExtraMinor,
} from '@/lib/insights';
import { affiliateApi } from '@/lib/endpoints';
import { useAffiliateHome } from '@/lib/useAffiliateHome';
import { errorMessage } from '@/lib/useApi';

export function AffiliateHome() {
  const { me, membership, memberships, switchTenant, logout } = useSession();
  const home = useAffiliateHome();
  const i18n = useT();
  const { t } = i18n;
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
            {firstName
              ? t('affiliate.home.greetingName', {
                  greeting: t(greetingKey(new Date(), tz)),
                  name: firstName,
                })
              : t('affiliate.home.greeting', { greeting: t(greetingKey(new Date(), tz)) })}
          </h1>
        </div>
        <div className="flex shrink-0 items-center">
          <LanguageSwitcher compact />
          <Link
            href="/account"
            aria-label={t('account.link')}
            title={t('account.link')}
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-brand hover:bg-brand-soft"
          >
            <IconShield />
          </Link>
          <Button
            variant="ghost"
            icon={<IconLogout />}
            onClick={() => void logout()}
            className="shrink-0 px-3"
          >
            {t('affiliate.home.logout')}
          </Button>
        </div>
      </header>

      {memberships.length > 1 ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">{t('affiliate.home.operator')}</span>
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
      <nav aria-label={t('affiliate.home.quickActions')} className="grid grid-cols-2 gap-3">
        <Link
          href="/a/book"
          className="flex min-h-28 flex-col justify-between rounded-3xl bg-brand p-4 text-on-brand shadow-sm hover:bg-brand-strong"
        >
          <IconCalendarPlus size={32} />
          <span className="text-left text-lg font-bold leading-tight">
            {t('affiliate.home.bookForTourist')}
          </span>
        </Link>
        <Link
          href="/a/qr"
          className="flex min-h-28 flex-col justify-between rounded-3xl border-2 border-line-strong bg-surface p-4 hover:bg-surface-2"
        >
          <IconQr size={32} />
          <span className="text-left text-lg font-bold leading-tight">
            {t('affiliate.home.showQr')}
          </span>
        </Link>
      </nav>

      {home.stale ? <Alert tone="warning">{t('affiliate.offlineStale')}</Alert> : null}
      {home.error && !data ? (
        <Alert
          tone="error"
          title={t('affiliate.loadFailed')}
          action={
            <Button variant="secondary" onClick={home.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(home.error, i18n)}
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
            {t('affiliate.home.kitLink')}
          </span>
          <IconChevronRight />
        </Link>
        <Link
          href="/a/links"
          className="flex min-h-14 items-center justify-between gap-3 rounded-2xl px-1 font-semibold text-brand"
        >
          <span className="flex items-center gap-2">
            <IconLink />
            {t('affiliate.home.linksLink')}
          </span>
          <IconChevronRight />
        </Link>
      </div>

      {data ? (
        <SaleMessages
          key={data.affiliate.id}
          enabled={data.affiliate.notifySales}
          contact={me.user.phone ?? me.user.email}
          onSaved={home.reload}
        />
      ) : null}
    </div>
  );
}

/** The affiliate's own switch for "you made a sale" and "your commission was paid". */
function SaleMessages({
  enabled,
  contact,
  onSaved,
}: {
  enabled: boolean;
  contact: string | null;
  onSaved: () => void;
}) {
  const i18n = useT();
  const { t } = i18n;
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setOn(next);
    setBusy(true);
    setError(null);
    try {
      const saved = await affiliateApi.updateNotifications({ sales: next });
      setOn(saved.sales);
      onSaved();
    } catch (err) {
      setOn(!next);
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t('affiliate.home.messagesTitle')}>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 size-6 shrink-0"
          checked={on}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">{t('affiliate.home.saleMessages')}</span>
          <span className="text-sm text-muted">
            {contact
              ? t('affiliate.home.saleMessagesHelp', { contact })
              : t('affiliate.home.saleMessagesHelpNoContact')}
          </span>
        </span>
      </label>
      {error ? (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      ) : null}
    </Card>
  );
}

function Dashboard({ data }: { data: AffiliateHomeDto }) {
  const i18n = useT();
  const { t, lang } = i18n;
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
        <Alert tone="warning" title={t('affiliate.home.suspendedTitle')}>
          {t('affiliate.home.suspendedBody')}
        </Alert>
      ) : null}

      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-semibold text-muted">
            {t('affiliate.home.earningsIn', { period: formatPeriod(data.periodKey, lang) })}
          </p>
          {daysLeft > 0 ? (
            <p className="shrink-0 text-sm text-muted">
              {t('affiliate.home.daysLeft', { count: daysLeft })}
            </p>
          ) : null}
        </div>
        <p className="mt-1 text-5xl font-extrabold tracking-tight">
          <MoneyText amountMinor={data.earnings.monthTotalMinor} currency={currency} lang={lang} />
        </p>
        <p className="mt-1 text-muted">
          {sales === 0
            ? t('affiliate.home.noSales')
            : current && current.salesMinor > 0
              ? t('affiliate.home.paidSalesWorth', {
                  count: sales,
                  amount: formatMoney(current.salesMinor, currency, lang),
                })
              : t('affiliate.home.paidSales', { count: sales })}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl bg-surface-2 p-3">
            <dt className="text-muted">{t('affiliate.home.pending')}</dt>
            <dd className="text-base font-semibold">
              <MoneyText amountMinor={data.earnings.pendingMinor} currency={currency} lang={lang} />
            </dd>
            <dd className="text-xs text-muted">{t('affiliate.home.pendingHint')}</dd>
          </div>
          <div className="rounded-2xl bg-surface-2 p-3">
            <dt className="text-muted">{t('affiliate.home.approved')}</dt>
            <dd className="text-base font-semibold">
              <MoneyText
                amountMinor={data.earnings.approvedMinor}
                currency={currency}
                lang={lang}
              />
            </dd>
            <dd className="text-xs text-muted">{t('affiliate.home.approvedHint')}</dd>
          </div>
        </dl>
        {data.earnings.payableMinor > 0 ? (
          <p className="mt-3 rounded-2xl bg-success-soft p-3 text-sm text-success-fg">
            {t('affiliate.home.payable')}{' '}
            <MoneyText
              amountMinor={data.earnings.payableMinor}
              currency={currency}
              lang={lang}
              className="font-bold"
            />
          </p>
        ) : null}
      </Card>

      <Card title={tiered ? t('affiliate.home.tierTitle') : t('affiliate.home.commissionTitle')}>
        <p className="text-lg font-semibold" id="tier-progress-label">
          {tierProgressSentence(data.progress, data.plan.kind, i18n)}
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
                {t('affiliate.home.extraBefore', {
                  rate: formatBps(data.progress.nextRateBps!, lang),
                })}
                <strong>{formatMoney(extra, currency, lang)}</strong>
                {t('affiliate.home.extraAfter')}
              </p>
            ) : null}
            <ol
              className="mt-4 grid gap-2"
              style={{ gridTemplateColumns: `repeat(${data.plan.tiers.length}, minmax(0, 1fr))` }}
            >
              {tierRows(data.plan.tiers, i18n).map((row, i) => {
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
                      {formatBps(row.rateBps, lang)}
                    </span>
                    <span className="text-xs leading-tight">
                      {tierShortLabel(data.plan.tiers, i, i18n)}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 text-sm text-muted">{t('affiliate.home.tierResets')}</p>
          </>
        ) : null}
      </Card>

      {history.length > 1 ? (
        <Card
          title={t('affiliate.home.recentMonths')}
          action={
            <Link
              href="/a/earnings"
              className="inline-flex min-h-12 items-center font-semibold text-brand"
            >
              {t('affiliate.home.details')}
            </Link>
          }
        >
          <EarningsChart history={history} currency={currency} />
          {previous ? (
            <p className="mt-3 text-sm text-muted">
              {t('affiliate.home.lastMonth', {
                count: previous.paidSales,
                amount: formatMoney(previous.commissionMinor, currency, lang),
              })}
              {best && best.periodKey !== previous.periodKey
                ? ` ${t('affiliate.home.bestMonth', {
                    period: formatPeriod(best.periodKey, lang),
                    amount: formatMoney(best.commissionMinor, currency, lang),
                  })}`
                : ''}
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card
        title={t('affiliate.home.recentBookings')}
        action={
          <Link
            href="/a/book"
            className="inline-flex min-h-12 items-center font-semibold text-brand"
          >
            {t('affiliate.home.book')}
          </Link>
        }
      >
        {data.recentBookings.length === 0 ? (
          <p className="text-muted">{t('affiliate.home.noBookings')}</p>
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
            {t('affiliate.home.showAll', { count: data.recentBookings.length })}
          </Button>
        ) : null}
      </Card>
    </>
  );
}

/** "1–3", "4–10", "11+" for the tier ladder. */
function tierShortLabel(tiers: { fromSale: number }[], index: number, { t }: Translator): string {
  const sorted = [...tiers].sort((a, b) => a.fromSale - b.fromSale);
  const tier = sorted[index]!;
  const next = sorted[index + 1];
  if (!next) return t('affiliate.home.tierShortFrom', { from: tier.fromSale });
  if (next.fromSale - 1 === tier.fromSale)
    return t('affiliate.home.tierShortOne', { from: tier.fromSale });
  return t('affiliate.home.tierShortRange', { from: tier.fromSale, to: next.fromSale - 1 });
}
