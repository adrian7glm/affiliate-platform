'use client';

import type { OperatorBillingDto } from '@ap/contracts';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/Alert';
import { useSession } from '@/components/AuthGate';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { IconCheck, IconExternal } from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { formatDate } from '@/lib/dates';
import { formatBps } from '@/lib/format';
import { pluralRo } from '@/lib/i18n';
import { operatorPlatformApi } from '@/lib/platform-endpoints';
import { SUBSCRIPTION_STATUS, daysUntil } from '@/lib/platform-labels';
import { errorMessageRo, useApi } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';

export function BillingScreen() {
  const { tenant } = useOperator();
  const { membership } = useSession();
  const billing = useApi(`operator-billing:${tenant.id}`, (signal) =>
    operatorPlatformApi.billing({ signal }),
  );
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('subscribed') === '1') setNotice('Mulțumim! Abonamentul este activ.');
    if (params.get('chosen') === '1')
      setNotice('Planul a fost schimbat. Primești factura pe email la începutul lunii.');
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Abonament"
        description="Ce plătești pentru platformă: abonamentul lunar și un mic procent din rezervările plătite."
      />
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {billing.error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={billing.reload}>
              Încearcă din nou
            </Button>
          }
        >
          {errorMessageRo(billing.error)}
        </Alert>
      ) : null}
      {billing.loading && !billing.data ? <LoadingBlock /> : null}
      {billing.data ? (
        <BillingContent
          data={billing.data}
          isOwner={membership.role === 'owner'}
          timezone={tenant.timezone}
          onChanged={(message) => {
            setNotice(message);
            billing.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function BillingContent({
  data,
  isOwner,
  timezone,
  onChanged,
}: {
  data: OperatorBillingDto;
  isOwner: boolean;
  timezone: string;
  onChanged: (message: string) => void;
}) {
  const sub = data.subscription;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(planId: string) {
    setBusy(planId);
    setError(null);
    try {
      const { url } = await operatorPlatformApi.checkout({ planId });
      if (data.provider === 'stripe') {
        window.location.assign(url);
        return;
      }
      onChanged('Planul a fost schimbat. Primești factura pe email la începutul lunii.');
    } catch (err) {
      setError(errorMessageRo(err));
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy('portal');
    setError(null);
    try {
      const { url } = await operatorPlatformApi.portal();
      window.location.assign(url);
    } catch (err) {
      setError(errorMessageRo(err));
      setBusy(null);
    }
  }

  const status = sub ? SUBSCRIPTION_STATUS[sub.status] : null;
  return (
    <>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title={sub ? `Planul ${sub.planName}` : 'Niciun plan încă'}
          action={status ? <StatusChip tone={status.tone}>{status.label}</StatusChip> : null}
        >
          {sub ? (
            <div className="flex flex-col gap-3">
              <p>
                <MoneyText
                  amountMinor={sub.monthlyPriceMinor}
                  currency={sub.currency}
                  className="text-3xl font-bold"
                />
                <span className="text-muted"> / lună</span>
              </p>
              <p>
                <span className="font-semibold">{formatBps(sub.platformFeeBps)}</span> din fiecare
                rezervare plătită
                {sub.feeBpsOverride !== null ? ' (tarif negociat)' : ''}
              </p>
              <p className="text-muted">
                {sub.maxAffiliates === null
                  ? 'Afiliați nelimitați'
                  : `Până la ${sub.maxAffiliates} afiliați activi`}
              </p>
              {sub.status === 'trialing' && sub.trialEndsAt ? (
                <Alert tone="info">
                  Perioada de probă gratuită mai are{' '}
                  {pluralRo(daysUntil(sub.trialEndsAt), 'zi', 'zile')} (până pe{' '}
                  {formatDate(sub.trialEndsAt, timezone)}).
                </Alert>
              ) : null}
              {sub.status === 'past_due' ? (
                <Alert tone="warning">
                  {sub.currentPeriodEnd
                    ? 'Plata abonamentului a eșuat sau nu a fost primită.'
                    : 'Perioada de probă s-a încheiat.'}{' '}
                  {data.provider === 'stripe'
                    ? 'Adaugă un card ca să continui fără întreruperi.'
                    : 'Te contactăm pentru factură.'}
                </Alert>
              ) : null}
              {sub.currentPeriodEnd && sub.status === 'active' ? (
                <p className="text-muted">
                  Plătit până pe {formatDate(sub.currentPeriodEnd, timezone)}.
                </p>
              ) : null}
              {isOwner && data.provider === 'stripe' && sub.billedByStripe ? (
                <Button
                  variant="secondary"
                  icon={<IconExternal />}
                  loading={busy === 'portal'}
                  onClick={() => void openPortal()}
                >
                  Card, facturi și anulare
                </Button>
              ) : null}
              {isOwner && data.provider === 'stripe' && !sub.billedByStripe ? (
                <Button loading={busy === sub.planId} onClick={() => void choose(sub.planId)}>
                  Adaugă cardul
                </Button>
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card title="Luna aceasta" description="Comisionul platformei pe rezervările plătite">
          <p>
            <MoneyText
              amountMinor={data.feesThisMonth.amountMinor}
              currency={data.feesThisMonth.currency}
              className="text-3xl font-bold"
            />
          </p>
          <p className="mt-1 text-muted">
            din {pluralRo(data.feesThisMonth.bookings, 'rezervare', 'rezervări')}
          </p>
          <p className="mt-3 text-sm text-muted">
            Rezervările anulate și rambursate nu se taxează.
          </p>
        </Card>
      </div>

      {data.plans.length > 1 || !sub ? (
        <section aria-labelledby="plans-title" className="flex flex-col gap-3">
          <h2 id="plans-title" className="text-xl font-bold">
            Planuri
          </h2>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.plans.map((plan) => {
              const current = sub?.planId === plan.id;
              return (
                <li key={plan.id}>
                  <Card className={`h-full ${current ? 'ring-2 ring-brand' : ''}`}>
                    <div className="flex h-full flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-lg font-bold">{plan.name}</h3>
                        {current ? <StatusChip tone="brand">Planul tău</StatusChip> : null}
                      </div>
                      {plan.description ? (
                        <p className="text-sm text-muted">{plan.description}</p>
                      ) : null}
                      <p>
                        <MoneyText
                          amountMinor={plan.monthlyPriceMinor}
                          currency={plan.currency}
                          className="text-xl font-bold"
                        />
                        <span className="text-muted">
                          {' '}
                          / lună + {formatBps(plan.platformFeeBps)} / rezervare
                        </span>
                      </p>
                      <p className="flex items-center gap-1.5 text-sm">
                        <IconCheck size={16} className="text-success" />
                        {plan.maxAffiliates === null
                          ? 'Afiliați nelimitați'
                          : `Până la ${plan.maxAffiliates} afiliați`}
                      </p>
                      {isOwner && !current ? (
                        <Button
                          variant="secondary"
                          className="mt-auto"
                          loading={busy === plan.id}
                          disabled={busy !== null}
                          onClick={() => void choose(plan.id)}
                        >
                          Alege {plan.name}
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
          {!isOwner ? (
            <p className="text-sm text-muted">
              Doar administratorul contului poate schimba planul.
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
