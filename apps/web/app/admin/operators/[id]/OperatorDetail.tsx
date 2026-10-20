'use client';

import type { AdminTenantDetailDto, PlatformPlanDto, UpdateTenantBillingBody } from '@ap/contracts';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { Field, SelectField, TextareaField } from '@/components/Field';
import { IconCheck, IconExternal, IconX } from '@/components/icons';
import { useT } from '@/components/I18nProvider';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { formatDate, formatDateTime, formatPeriod } from '@/lib/dates';
import {
  bpsToPercentInput,
  formatBps,
  minorToInput,
  parseMoneyInput,
  percentToBps,
} from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { adminApi } from '@/lib/platform-endpoints';
import { onboardingStep, subscriptionStatus, tenantStatus } from '@/lib/platform-labels';
import { errorMessage, useApi } from '@/lib/useApi';

const PLATFORM_TZ = 'Europe/Bucharest';

const AUDIT_LABELS: Record<string, MessageKey> = {
  'tenant.created': 'admin.operators.audit.tenantCreated',
  'tenant.suspended': 'admin.operators.audit.tenantSuspended',
  'tenant.reactivated': 'admin.operators.audit.tenantReactivated',
  'subscription.updated': 'admin.operators.audit.subscriptionUpdated',
  'subscription.plan_chosen': 'admin.operators.audit.subscriptionPlanChosen',
  'subscription.stripe_sync': 'admin.operators.audit.subscriptionStripeSync',
};

/** "2026-11-05" (a date input) -> end of that day, as an ISO instant. */
function endOfDay(dateKey: string): string {
  return new Date(`${dateKey}T23:59:59`).toISOString();
}

function dateKeyOf(iso: string | null, fallbackDays = 0): string {
  const date = iso ? new Date(iso) : new Date(Date.now() + fallbackDays * 86_400_000);
  return date.toLocaleDateString('sv-SE', { timeZone: PLATFORM_TZ });
}

export function OperatorDetail({ id }: { id: string }) {
  const i18n = useT();
  const { t, tp, lang } = i18n;
  const detail = useApi(`admin-tenant:${id}`, (signal) => adminApi.tenant(id, { signal }));
  const plans = useApi('admin-plans', (signal) => adminApi.plans({ signal }));
  const [suspendOpen, setSuspendOpen] = useState(false);

  if (detail.error) {
    return (
      <div className="pt-4">
        <PageHeader
          title={t('admin.operators.title')}
          backHref="/admin"
          backLabel={t('admin.nav.operators')}
        />
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={detail.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(detail.error, i18n)}
        </Alert>
      </div>
    );
  }
  if (!detail.data) return <LoadingBlock />;
  const tenant = detail.data;
  const status = tenantStatus(i18n, tenant.status);
  const thisMonth = tenant.months.at(-1);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={tenant.name}
        backHref="/admin"
        backLabel={t('admin.nav.operators')}
        description={t('admin.operators.since', {
          date: formatDate(tenant.createdAt, PLATFORM_TZ, lang),
          currency: tenant.currency,
          timezone: tenant.timezone,
        })}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone={status.tone}>{status.label}</StatusChip>
            <a
              href={`/b/${tenant.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-12 items-center gap-1.5 rounded-2xl px-3 font-semibold text-brand hover:bg-brand-soft"
            >
              {t('admin.operators.publicPage')} <IconExternal size={18} />
            </a>
          </div>
        }
      />

      {tenant.status === 'suspended' ? (
        <Alert
          tone="error"
          title={
            tenant.suspendedAt
              ? t('admin.operators.suspendedOn', {
                  date: formatDate(tenant.suspendedAt, PLATFORM_TZ, lang),
                })
              : t('admin.operators.suspended')
          }
          action={<ReactivateButton id={tenant.id} onDone={(next) => detail.setData(next)} />}
        >
          {t('admin.operators.suspendedBody', { reason: tenant.suspendedReason ?? '' })}
        </Alert>
      ) : null}

      <section
        aria-label={t('admin.operators.thisMonth')}
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
      >
        <Stat label={t('admin.operators.bookingsThisMonth')} value={thisMonth?.bookings ?? 0} />
        <Stat
          label={t('admin.operators.gross')}
          value={
            <MoneyText
              amountMinor={thisMonth?.grossMinor ?? 0}
              currency={tenant.currency}
              lang={lang}
            />
          }
        />
        <Stat
          label={t('admin.operators.platformFee')}
          value={
            <MoneyText
              amountMinor={thisMonth?.platformFeesMinor ?? 0}
              currency={tenant.currency}
              lang={lang}
            />
          }
        />
        <Stat
          label={t('admin.operators.network')}
          value={tp('admin.count.affiliates', tenant.affiliates)}
          hint={tp('admin.count.trips', tenant.products)}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <SubscriptionCard
          detail={tenant}
          plans={plans.data ?? []}
          onSaved={() => detail.reload()}
        />
        <MonthsCard detail={tenant} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title={t('admin.operators.setupTitle')}
          description={t('admin.operators.setupProgress', {
            done: tenant.setup.completed,
            total: tenant.setup.total,
          })}
        >
          <ul className="flex flex-col gap-2">
            {tenant.setup.steps.map((step) => (
              <li key={step.key} className="flex items-center gap-2">
                {step.done ? (
                  <IconCheck className="shrink-0 text-success" size={20} />
                ) : (
                  <span
                    aria-hidden="true"
                    className="inline-block size-5 shrink-0 rounded-full border-2 border-line-strong"
                  />
                )}
                <span className={step.done ? '' : 'text-muted'}>
                  {onboardingStep(i18n, step.key).label}
                  <span className="visually-hidden">
                    {step.done ? t('admin.operators.stepDone') : t('admin.operators.stepTodo')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={t('admin.operators.contactTitle')}>
          {tenant.owners.length === 0 ? (
            <p className="text-muted">{t('admin.operators.noOwners')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {tenant.owners.map((o) => (
                <li key={o.userId}>
                  <p className="font-semibold">{o.name ?? t('admin.operators.ownerFallback')}</p>
                  <p className="flex flex-wrap gap-x-3 text-sm">
                    {o.email ? (
                      <a className="text-brand underline" href={`mailto:${o.email}`}>
                        {o.email}
                      </a>
                    ) : null}
                    {o.phone ? (
                      <a className="text-brand underline" href={`tel:${o.phone}`}>
                        {o.phone}
                      </a>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-muted">
            {tenant.stripeAccountConnected
              ? t('admin.operators.paymentsStripe')
              : t('admin.operators.paymentsPlatform')}
          </p>
        </Card>
      </div>

      <Card title={t('admin.operators.historyTitle')}>
        {tenant.audit.length === 0 ? (
          <p className="text-muted">{t('admin.operators.historyEmpty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {tenant.audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-2.5">
                <span>
                  <span className="font-semibold">
                    {AUDIT_LABELS[entry.action] ? t(AUDIT_LABELS[entry.action]!) : entry.action}
                  </span>
                  {typeof entry.data.reason === 'string' ? ` · ${entry.data.reason}` : ''}
                  {entry.actor ? <span className="text-muted"> · {entry.actor}</span> : null}
                </span>
                <span className="text-sm text-muted">
                  {formatDateTime(entry.createdAt, PLATFORM_TZ, lang)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {tenant.status === 'active' ? (
        <Card
          title={t('admin.operators.suspendTitle')}
          description={t('admin.operators.suspendDescription')}
        >
          <Button variant="danger" onClick={() => setSuspendOpen(true)}>
            {t('admin.operators.suspendButton')}
          </Button>
        </Card>
      ) : null}

      <SuspendDialog
        open={suspendOpen}
        tenant={tenant}
        onClose={() => setSuspendOpen(false)}
        onDone={(next) => {
          setSuspendOpen(false);
          detail.setData(next);
        }}
      />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-3xl border border-line bg-surface p-4">
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

function MonthsCard({ detail }: { detail: AdminTenantDetailDto }) {
  const { t, tp, lang } = useT();
  const max = Math.max(1, ...detail.months.map((m) => m.platformFeesMinor));
  return (
    <Card
      title={t('admin.operators.monthsTitle')}
      description={t('admin.operators.monthsDescription')}
    >
      <ul className="flex flex-col gap-2.5">
        {detail.months.map((m) => (
          <li key={m.period} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3">
            <span className="text-sm capitalize text-muted">{formatPeriod(m.period, lang)}</span>
            <span className="h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
              <span
                className="block h-full rounded-full bg-brand"
                style={{ width: `${(m.platformFeesMinor / max) * 100}%` }}
              />
            </span>
            <span className="text-right text-sm">
              <MoneyText
                amountMinor={m.platformFeesMinor}
                currency={detail.currency}
                lang={lang}
                className="font-semibold"
              />
              <span className="block text-muted">{tp('admin.count.bookings', m.bookings)}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SubscriptionCard({
  detail,
  plans,
  onSaved,
}: {
  detail: AdminTenantDetailDto;
  plans: PlatformPlanDto[];
  onSaved: () => void;
}) {
  const i18n = useT();
  const { t, lang } = i18n;
  const sub = detail.subscription;
  const [editing, setEditing] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [trialOpen, setTrialOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(body: UpdateTenantBillingBody, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await adminApi.setBilling(detail.id, body);
      setMessage(done);
      setEditing(false);
      setPaymentOpen(false);
      setTrialOpen(false);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  const state = sub ? subscriptionStatus(i18n, sub.status) : null;
  return (
    <Card
      title={t('admin.operators.subscription.title')}
      action={state ? <StatusChip tone={state.tone}>{state.label}</StatusChip> : null}
    >
      {message ? (
        <Alert tone="success" className="mb-3">
          {message}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="error" className="mb-3">
          {error}
        </Alert>
      ) : null}
      {sub ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Term label={t('admin.operators.subscription.plan')}>{sub.planName}</Term>
          <Term label={t('admin.operators.subscription.monthly')}>
            <MoneyText amountMinor={sub.monthlyPriceMinor} currency={sub.currency} lang={lang} />
            {sub.priceMinorOverride !== null ? <Negotiated /> : null}
          </Term>
          <Term label={t('admin.operators.subscription.fee')}>
            {formatBps(sub.platformFeeBps, lang)}
            {sub.feeBpsOverride !== null ? <Negotiated /> : null}
          </Term>
          <Term label={t('admin.operators.subscription.affiliatesIncluded')}>
            {sub.maxAffiliates === null
              ? t('admin.operators.subscription.unlimited')
              : t('admin.operators.subscription.upTo', { count: sub.maxAffiliates })}
          </Term>
          {sub.trialEndsAt && (sub.status === 'trialing' || sub.status === 'past_due') ? (
            <Term label={t('admin.operators.subscription.trialEnds')}>
              {formatDate(sub.trialEndsAt, PLATFORM_TZ, lang)}
            </Term>
          ) : null}
          {sub.currentPeriodEnd ? (
            <Term label={t('admin.operators.subscription.paidUntil')}>
              {formatDate(sub.currentPeriodEnd, PLATFORM_TZ, lang)}
            </Term>
          ) : null}
          <Term label={t('admin.operators.subscription.billing')}>
            {sub.billedByStripe
              ? t('admin.operators.subscription.billingStripe')
              : t('admin.operators.subscription.billingManual')}
          </Term>
        </dl>
      ) : (
        <p className="text-muted">{t('admin.operators.subscription.none')}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setEditing(true)}>
          {sub
            ? t('admin.operators.subscription.change')
            : t('admin.operators.subscription.choose')}
        </Button>
        {sub && !sub.billedByStripe ? (
          <Button variant="secondary" icon={<IconCheck />} onClick={() => setPaymentOpen(true)}>
            {t('admin.operators.subscription.recordPayment')}
          </Button>
        ) : null}
        {sub &&
        (sub.status === 'trialing' || (sub.status === 'past_due' && !sub.currentPeriodEnd)) ? (
          <Button variant="ghost" onClick={() => setTrialOpen(true)}>
            {t('admin.operators.subscription.extendTrial')}
          </Button>
        ) : null}
      </div>

      <TariffDialog
        open={editing}
        detail={detail}
        plans={plans}
        busy={busy}
        error={error}
        onClose={() => setEditing(false)}
        onSave={(body) => void save(body, t('admin.operators.subscription.updated'))}
      />

      <DateDialog
        open={paymentOpen}
        title={t('admin.operators.subscription.recordPayment')}
        description={t('admin.operators.subscription.paymentDescription')}
        label={t('admin.operators.subscription.paidUntil')}
        initial={dateKeyOf(null, 31)}
        busy={busy}
        error={error}
        submitLabel={t('admin.operators.subscription.markPaid')}
        onClose={() => setPaymentOpen(false)}
        onSave={(day) =>
          void save({ paidUntil: endOfDay(day) }, t('admin.operators.subscription.paymentRecorded'))
        }
        extra={
          sub && sub.status !== 'canceled' ? (
            <Button
              variant="ghost"
              icon={<IconX />}
              disabled={busy}
              onClick={() => void save({ cancel: true }, t('admin.operators.subscription.stopped'))}
            >
              {t('admin.operators.subscription.stop')}
            </Button>
          ) : null
        }
      />

      <DateDialog
        open={trialOpen}
        title={t('admin.operators.subscription.trialTitle')}
        label={t('admin.operators.subscription.trialLabel')}
        initial={dateKeyOf(sub?.trialEndsAt ?? null, 14)}
        busy={busy}
        error={error}
        submitLabel={t('admin.operators.subscription.save')}
        onClose={() => setTrialOpen(false)}
        onSave={(day) =>
          void save({ trialEndsAt: endOfDay(day) }, t('admin.operators.subscription.trialExtended'))
        }
      />
    </Card>
  );
}

function Negotiated() {
  const { t } = useT();
  return (
    <span className="ml-1.5 text-sm font-normal text-muted">
      {t('admin.operators.subscription.negotiated')}
    </span>
  );
}

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

function TariffDialog({
  open,
  detail,
  plans,
  busy,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  detail: AdminTenantDetailDto;
  plans: PlatformPlanDto[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (body: UpdateTenantBillingBody) => void;
}) {
  const { t, lang } = useT();
  const sub = detail.subscription;
  const offered = plans.filter((p) => p.isActive || p.id === sub?.planId);
  const [chosenPlanId, setPlanId] = useState(sub?.planId ?? '');
  const planId = chosenPlanId || offered[0]?.id || '';
  const [fee, setFee] = useState(
    sub?.feeBpsOverride != null ? bpsToPercentInput(sub.feeBpsOverride) : '',
  );
  const [price, setPrice] = useState(
    sub?.priceMinorOverride != null ? minorToInput(sub.priceMinorOverride, sub.currency) : '',
  );
  const [fieldError, setFieldError] = useState<string | null>(null);
  const plan = plans.find((p) => p.id === planId);
  const currency = plan?.currency ?? sub?.currency ?? 'EUR';
  // Stripe Billing charges the plan's Stripe price: a negotiated price needs its own plan.
  const priceAllowed = sub?.priceOverrideAllowed ?? true;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const feeBps = fee.trim() ? percentToBps(fee) : null;
    if (fee.trim() && (feeBps === null || feeBps > 5_000)) {
      setFieldError(t('admin.operators.tariff.feeError'));
      return;
    }
    const priceMinor = priceAllowed && price.trim() ? parseMoneyInput(price, currency) : null;
    if (priceAllowed && price.trim() && priceMinor === null) {
      setFieldError(t('admin.validation.price'));
      return;
    }
    setFieldError(null);
    onSave({
      ...(planId && planId !== sub?.planId ? { planId } : {}),
      feeBpsOverride: feeBps,
      ...(priceAllowed ? { priceMinorOverride: priceMinor } : {}),
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('admin.operators.tariff.title')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <SelectField
          label={t('admin.operators.tariff.plan')}
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
        >
          {offered.map((p) => (
            <option key={p.id} value={p.id}>
              {t('admin.operators.tariff.planOption', {
                name: p.name,
                price: minorToInput(p.monthlyPriceMinor, p.currency),
                currency: p.currency,
                fee: formatBps(p.platformFeeBps, lang),
              })}
            </option>
          ))}
        </SelectField>
        <Field
          label={t('admin.operators.tariff.fee')}
          hint={
            plan
              ? t('admin.operators.tariff.feeHintWith', {
                  fee: formatBps(plan.platformFeeBps, lang),
                })
              : t('admin.operators.tariff.feeHint')
          }
          inputMode="decimal"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          placeholder={plan ? bpsToPercentInput(plan.platformFeeBps) : ''}
        />
        {priceAllowed ? (
          <Field
            label={t('admin.operators.tariff.price', { currency })}
            hint={
              plan
                ? t('admin.operators.tariff.priceHintWith', {
                    price: `${minorToInput(plan.monthlyPriceMinor, plan.currency)} ${plan.currency}`,
                  })
                : t('admin.operators.tariff.priceHint')
            }
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            error={fieldError ?? undefined}
          />
        ) : (
          <p className="text-sm text-muted">{t('admin.operators.tariff.priceStripe')}</p>
        )}
        {!priceAllowed && fieldError ? <Alert tone="error">{fieldError}</Alert> : null}
        <p className="text-sm text-muted">{t('admin.operators.tariff.note')}</p>
        <Button type="submit" loading={busy} size="lg">
          {t('admin.operators.tariff.save')}
        </Button>
      </form>
    </Dialog>
  );
}

function DateDialog({
  open,
  title,
  description,
  label,
  initial,
  busy,
  error,
  submitLabel,
  onClose,
  onSave,
  extra,
}: {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  initial: string;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  onClose: () => void;
  onSave: (dateKey: string) => void;
  extra?: ReactNode;
}) {
  const [day, setDay] = useState(initial);
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (day) onSave(day);
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field
          label={label}
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          required
        />
        <Button type="submit" loading={busy} size="lg">
          {submitLabel}
        </Button>
        {extra}
      </form>
    </Dialog>
  );
}

function SuspendDialog({
  open,
  tenant,
  onClose,
  onDone,
}: {
  open: boolean;
  tenant: AdminTenantDetailDto;
  onClose: () => void;
  onDone: (next: AdminTenantDetailDto) => void;
}) {
  const i18n = useT();
  const { t } = i18n;
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setError(t('admin.operators.suspendDialog.reasonError'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(await adminApi.setStatus(tenant.id, { status: 'suspended', reason: reason.trim() }));
      setReason('');
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('admin.operators.suspendDialog.title', { name: tenant.name })}
      description={t('admin.operators.suspendDialog.description')}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextareaField
          label={t('admin.operators.suspendDialog.reason')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('admin.operators.suspendDialog.placeholder')}
          error={error ?? undefined}
          rows={3}
        />
        <Button type="submit" variant="danger" loading={busy} size="lg">
          {t('admin.operators.suspendDialog.submit')}
        </Button>
      </form>
    </Dialog>
  );
}

function ReactivateButton({
  id,
  onDone,
}: {
  id: string;
  onDone: (next: AdminTenantDetailDto) => void;
}) {
  const i18n = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="secondary"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            onDone(await adminApi.setStatus(id, { status: 'active' }));
          } catch (err) {
            setError(errorMessage(err, i18n));
          } finally {
            setBusy(false);
          }
        }}
      >
        {i18n.t('admin.operators.reactivate')}
      </Button>
      {error ? <p className="text-sm">{error}</p> : null}
    </div>
  );
}
