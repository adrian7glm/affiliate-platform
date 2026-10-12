'use client';

import Link from 'next/link';
import { Alert } from '@/components/Alert';
import { useSession } from '@/components/AuthGate';
import { BookingItem } from '@/components/BookingItem';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import {
  IconCalendarPlus,
  IconChevronRight,
  IconLink,
  IconLogout,
  IconQr,
  IconWallet,
} from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { LoadingBlock } from '@/components/Spinner';
import { tierProgressFraction, tierProgressSentence } from '@/lib/commission';
import { DEFAULT_TIMEZONE, formatPeriod, greetingRo } from '@/lib/dates';
import { formatBps } from '@/lib/format';
import { useAffiliateHome } from '@/lib/useAffiliateHome';
import { errorMessageRo } from '@/lib/useApi';

export function AffiliateHome() {
  const { me, membership, memberships, switchTenant, logout } = useSession();
  const home = useAffiliateHome();
  const data = home.data;
  const firstName = (data?.affiliate.displayName ?? me.user.name ?? '')
    .trim()
    .split(/[\s,(·-]+/)[0];

  return (
    <div className="page-x mx-auto flex max-w-xl flex-col gap-4">
      <header className="flex items-start justify-between gap-3 pt-4">
        <div className="min-w-0">
          <p className="text-muted">{data?.tenant.name ?? membership.tenantName}</p>
          <h1 className="text-2xl font-bold">
            {greetingRo(new Date(), DEFAULT_TIMEZONE)}
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

      {data ? (
        <>
          {data.affiliate.status === 'suspended' ? (
            <Alert tone="warning" title="Cont suspendat">
              Operatorul a suspendat temporar contul tău. Linkurile și rezervările noi nu mai aduc
              comision.
            </Alert>
          ) : null}

          <Card>
            <p className="font-semibold text-muted">
              Câștigul tău în {formatPeriod(data.periodKey)}
            </p>
            <p className="mt-1 text-4xl font-extrabold tracking-tight">
              <MoneyText
                amountMinor={data.earnings.monthTotalMinor}
                currency={data.tenant.currency}
              />
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-surface-2 p-3">
                <dt className="text-muted">În așteptare</dt>
                <dd className="text-base font-semibold">
                  <MoneyText
                    amountMinor={data.earnings.pendingMinor}
                    currency={data.tenant.currency}
                  />
                </dd>
              </div>
              <div className="rounded-2xl bg-surface-2 p-3">
                <dt className="text-muted">Aprobat</dt>
                <dd className="text-base font-semibold">
                  <MoneyText
                    amountMinor={data.earnings.approvedMinor}
                    currency={data.tenant.currency}
                  />
                </dd>
              </div>
            </dl>
            {data.earnings.payableMinor > 0 ? (
              <p className="mt-3 text-sm">
                De încasat de la operator:{' '}
                <MoneyText
                  amountMinor={data.earnings.payableMinor}
                  currency={data.tenant.currency}
                  className="font-semibold"
                />
              </p>
            ) : null}

            <div className="mt-4 border-t border-line pt-4">
              <p className="text-lg font-semibold" id="tier-progress-label">
                {tierProgressSentence(data.progress, data.plan.kind)}
              </p>
              {data.plan.kind === 'tiered' && data.progress.tierCount > 1 ? (
                <>
                  <progress
                    className="progress-bar mt-3"
                    max={100}
                    value={Math.round(tierProgressFraction(data.progress, data.plan.tiers) * 100)}
                    aria-labelledby="tier-progress-label"
                  />
                  <p className="mt-2 text-sm text-muted">
                    {data.progress.paidSales === 1
                      ? 'O vânzare plătită luna aceasta'
                      : `${data.progress.paidSales} vânzări plătite luna aceasta`}{' '}
                    · acum {formatBps(data.progress.currentRateBps)}
                  </p>
                </>
              ) : null}
            </div>
          </Card>
        </>
      ) : null}

      <nav aria-label="Acțiuni rapide" className="flex flex-col gap-3">
        <ButtonLink href="/a/qr" size="xl" block icon={<IconQr size={28} />}>
          Arată QR
        </ButtonLink>
        <ButtonLink href="/a/book" size="xl" block icon={<IconCalendarPlus size={28} />}>
          Rezervă acum
        </ButtonLink>
        <ButtonLink
          href="/a/earnings"
          size="xl"
          variant="secondary"
          block
          icon={<IconWallet size={28} />}
        >
          Câștigurile mele
        </ButtonLink>
      </nav>

      <Link
        href="/a/links"
        className="flex min-h-14 items-center justify-between gap-3 rounded-2xl px-1 font-semibold text-brand"
      >
        <span className="flex items-center gap-2">
          <IconLink />
          Linkurile mele și afișe de tipărit
        </span>
        <IconChevronRight />
      </Link>

      {data ? (
        <Card title="Rezervări recente">
          {data.recentBookings.length === 0 ? (
            <p className="text-muted">
              Încă nu ai rezervări. Arată codul QR turiștilor sau rezervă direct pentru ei.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {data.recentBookings.map((booking) => (
                <li key={booking.id}>
                  <BookingItem booking={booking} timezone={DEFAULT_TIMEZONE} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
