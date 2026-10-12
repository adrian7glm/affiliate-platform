'use client';

import type { OperatorBillingDto } from '@ap/contracts';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/Alert';
import { useSession } from '@/components/AuthGate';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useT } from '@/components/I18nProvider';
import { IconCheck, IconExternal } from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { formatDate } from '@/lib/dates';
import { formatBps } from '@/lib/format';
import { operatorPlatformApi } from '@/lib/platform-endpoints';
import { daysUntil, subscriptionStatus } from '@/lib/platform-labels';
import { errorMessage, useApi } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';
import { Rich, slots } from '../Rich';

export function BillingScreen() {
  const tr = useT();
  const { t } = tr;
  const { tenant } = useOperator();
  const { membership } = useSession();
  const billing = useApi(`operator-billing:${tenant.id}`, (signal) =>
    operatorPlatformApi.billing({ signal }),
  );
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('subscribed') === '1') setNotice(t('operator.billing.subscribed'));
    if (params.get('chosen') === '1') setNotice(t('operator.billing.planChanged'));
    // Only on arrival; a language switch later does not need to replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('operator.billing.title')}
        description={t('operator.billing.description')}
      />
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {billing.error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={billing.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(billing.error, tr)}
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
  const tr = useT();
  const { t, tp, lang } = tr;
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
      onChanged(t('operator.billing.planChanged'));
    } catch (err) {
      setError(errorMessage(err, tr));
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
      setError(errorMessage(err, tr));
      setBusy(null);
    }
  }

  const status = sub ? subscriptionStatus(tr, sub.status) : null;
  return (
    <>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title={
            sub
              ? t('operator.billing.planTitle', { name: sub.planName })
              : t('operator.billing.noPlan')
          }
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
                <span className="text-muted"> {t('operator.billing.perMonth')}</span>
              </p>
              <p>
                <Rich
                  text={t(
                    sub.feeBpsOverride !== null
                      ? 'operator.billing.feeLineNegotiated'
                      : 'operator.billing.feeLine',
                    slots('fee'),
                  )}
                  parts={{
                    fee: (
                      <span className="font-semibold">{formatBps(sub.platformFeeBps, lang)}</span>
                    ),
                  }}
                />
              </p>
              <p className="text-muted">
                {sub.maxAffiliates === null
                  ? t('operator.billing.unlimited')
                  : tp('operator.billing.upToActive', sub.maxAffiliates)}
              </p>
              {sub.status === 'trialing' && sub.trialEndsAt ? (
                <Alert tone="info">
                  {tp('operator.billing.trialLeft', daysUntil(sub.trialEndsAt), {
                    date: formatDate(sub.trialEndsAt, timezone, lang),
                  })}
                </Alert>
              ) : null}
              {sub.status === 'past_due' ? (
                <Alert tone="warning">
                  {sub.currentPeriodEnd
                    ? t('operator.billing.paymentFailed')
                    : t('operator.billing.trialEnded')}{' '}
                  {data.provider === 'stripe'
                    ? t('operator.billing.addCardToContinue')
                    : t('operator.billing.invoiceContact')}
                </Alert>
              ) : null}
              {sub.currentPeriodEnd && sub.status === 'active' ? (
                <p className="text-muted">
                  {t('operator.billing.paidUntil', {
                    date: formatDate(sub.currentPeriodEnd, timezone, lang),
                  })}
                </p>
              ) : null}
              {isOwner && data.provider === 'stripe' && sub.billedByStripe ? (
                <Button
                  variant="secondary"
                  icon={<IconExternal />}
                  loading={busy === 'portal'}
                  onClick={() => void openPortal()}
                >
                  {t('operator.billing.portal')}
                </Button>
              ) : null}
              {isOwner && data.provider === 'stripe' && !sub.billedByStripe ? (
                <Button loading={busy === sub.planId} onClick={() => void choose(sub.planId)}>
                  {t('operator.billing.addCard')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card
          title={t('operator.billing.thisMonth')}
          description={t('operator.billing.thisMonthDescription')}
        >
          <p>
            <MoneyText
              amountMinor={data.feesThisMonth.amountMinor}
              currency={data.feesThisMonth.currency}
              className="text-3xl font-bold"
            />
          </p>
          <p className="mt-1 text-muted">
            {tp('operator.billing.fromBookings', data.feesThisMonth.bookings)}
          </p>
          <p className="mt-3 text-sm text-muted">{t('operator.billing.notCharged')}</p>
        </Card>
      </div>

      {data.plans.length > 1 || !sub ? (
        <section aria-labelledby="plans-title" className="flex flex-col gap-3">
          <h2 id="plans-title" className="text-xl font-bold">
            {t('operator.billing.plans')}
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
                        {current ? (
                          <StatusChip tone="brand">{t('operator.billing.yourPlan')}</StatusChip>
                        ) : null}
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
                          {t('operator.billing.planPrice', {
                            fee: formatBps(plan.platformFeeBps, lang),
                          })}
                        </span>
                      </p>
                      <p className="flex items-center gap-1.5 text-sm">
                        <IconCheck size={16} className="text-success" />
                        {plan.maxAffiliates === null
                          ? t('operator.billing.unlimited')
                          : tp('operator.billing.upTo', plan.maxAffiliates)}
                      </p>
                      {isOwner && !current ? (
                        <Button
                          variant="secondary"
                          className="mt-auto"
                          loading={busy === plan.id}
                          disabled={busy !== null}
                          onClick={() => void choose(plan.id)}
                        >
                          {t('operator.billing.choose', { name: plan.name })}
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
          {!isOwner ? (
            <p className="text-sm text-muted">{t('operator.billing.ownerOnly')}</p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
