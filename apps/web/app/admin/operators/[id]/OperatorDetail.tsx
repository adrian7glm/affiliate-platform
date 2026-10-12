'use client';

import type { AdminTenantDetailDto, PlatformPlanDto, UpdateTenantBillingBody } from '@ap/contracts';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { Field, SelectField, TextareaField } from '@/components/Field';
import { IconCheck, IconExternal, IconX } from '@/components/icons';
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
import { pluralRo } from '@/lib/i18n';
import { adminApi } from '@/lib/platform-endpoints';
import { ONBOARDING_STEPS, SUBSCRIPTION_STATUS, TENANT_STATUS } from '@/lib/platform-labels';
import { errorMessageRo, useApi } from '@/lib/useApi';

const PLATFORM_TZ = 'Europe/Bucharest';

const AUDIT_LABELS: Record<string, string> = {
  'tenant.created': 'Cont deschis',
  'tenant.suspended': 'Suspendat',
  'tenant.reactivated': 'Reactivat',
  'subscription.updated': 'Abonament modificat',
  'subscription.plan_chosen': 'Operatorul a ales alt plan',
  'subscription.stripe_sync': 'Actualizare de la Stripe',
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
  const detail = useApi(`admin-tenant:${id}`, (signal) => adminApi.tenant(id, { signal }));
  const plans = useApi('admin-plans', (signal) => adminApi.plans({ signal }));
  const [suspendOpen, setSuspendOpen] = useState(false);

  if (detail.error) {
    return (
      <div className="pt-4">
        <PageHeader title="Operator" backHref="/admin" backLabel="Operatori" />
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={detail.reload}>
              Încearcă din nou
            </Button>
          }
        >
          {errorMessageRo(detail.error)}
        </Alert>
      </div>
    );
  }
  if (!detail.data) return <LoadingBlock />;
  const t = detail.data;
  const status = TENANT_STATUS[t.status];
  const thisMonth = t.months.at(-1);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.name}
        backHref="/admin"
        backLabel="Operatori"
        description={`Pe platformă din ${formatDate(t.createdAt, PLATFORM_TZ)} · ${t.currency} · ${t.timezone}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone={status.tone}>{status.label}</StatusChip>
            <a
              href={`/b/${t.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-12 items-center gap-1.5 rounded-2xl px-3 font-semibold text-brand hover:bg-brand-soft"
            >
              Pagina publică <IconExternal size={18} />
            </a>
          </div>
        }
      />

      {t.status === 'suspended' ? (
        <Alert
          tone="error"
          title={`Suspendat pe ${t.suspendedAt ? formatDate(t.suspendedAt, PLATFORM_TZ) : ''}`}
          action={<ReactivateButton id={t.id} onDone={(next) => detail.setData(next)} />}
        >
          {t.suspendedReason}. Operatorul nu poate intra în administrare, afiliații nu pot rezerva,
          iar paginile de rezervare sunt oprite.
        </Alert>
      ) : null}

      <section aria-label="Luna aceasta" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Rezervări luna aceasta" value={thisMonth?.bookings ?? 0} />
        <Stat
          label="Valoare vândută"
          value={<MoneyText amountMinor={thisMonth?.grossMinor ?? 0} currency={t.currency} />}
        />
        <Stat
          label="Comision platformă"
          value={
            <MoneyText amountMinor={thisMonth?.platformFeesMinor ?? 0} currency={t.currency} />
          }
        />
        <Stat
          label="Rețea"
          value={pluralRo(t.affiliates, 'afiliat', 'afiliați')}
          hint={pluralRo(t.products, 'excursie', 'excursii')}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <SubscriptionCard detail={t} plans={plans.data ?? []} onSaved={() => detail.reload()} />
        <MonthsCard detail={t} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Pornire" description={`${t.setup.completed} din ${t.setup.total} pași făcuți`}>
          <ul className="flex flex-col gap-2">
            {t.setup.steps.map((step) => (
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
                  {ONBOARDING_STEPS[step.key].label}
                  <span className="visually-hidden">{step.done ? ': făcut' : ': de făcut'}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Contact">
          {t.owners.length === 0 ? (
            <p className="text-muted">Niciun administrator.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {t.owners.map((o) => (
                <li key={o.userId}>
                  <p className="font-semibold">{o.name ?? 'Administrator'}</p>
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
            Plăți online:{' '}
            {t.stripeAccountConnected
              ? 'cont Stripe conectat'
              : 'prin contul platformei (fără cont Stripe propriu)'}
          </p>
        </Card>
      </div>

      <Card title="Istoric">
        {t.audit.length === 0 ? (
          <p className="text-muted">Nimic încă.</p>
        ) : (
          <ul className="divide-y divide-line">
            {t.audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-2.5">
                <span>
                  <span className="font-semibold">
                    {AUDIT_LABELS[entry.action] ?? entry.action}
                  </span>
                  {typeof entry.data.reason === 'string' ? ` · ${entry.data.reason}` : ''}
                  {entry.actor ? <span className="text-muted"> · {entry.actor}</span> : null}
                </span>
                <span className="text-sm text-muted">
                  {formatDateTime(entry.createdAt, PLATFORM_TZ)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {t.status === 'active' ? (
        <Card
          title="Suspendare"
          description="Oprește accesul operatorului și paginile lui de rezervare, de exemplu pentru abonament neplătit. Datele rămân și poți reactiva oricând."
        >
          <Button variant="danger" onClick={() => setSuspendOpen(true)}>
            Suspendă operatorul
          </Button>
        </Card>
      ) : null}

      <SuspendDialog
        open={suspendOpen}
        tenant={t}
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
  const max = Math.max(1, ...detail.months.map((m) => m.platformFeesMinor));
  return (
    <Card title="Comision platformă pe luni" description="Ultimele șase luni">
      <ul className="flex flex-col gap-2.5">
        {detail.months.map((m) => (
          <li key={m.period} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3">
            <span className="text-sm capitalize text-muted">{formatPeriod(m.period)}</span>
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
                className="font-semibold"
              />
              <span className="block text-muted">
                {pluralRo(m.bookings, 'rezervare', 'rezervări')}
              </span>
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
      setError(errorMessageRo(err));
    } finally {
      setBusy(false);
    }
  }

  const state = sub ? SUBSCRIPTION_STATUS[sub.status] : null;
  return (
    <Card
      title="Abonament"
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
          <Term label="Plan">{sub.planName}</Term>
          <Term label="Abonament lunar">
            <MoneyText amountMinor={sub.monthlyPriceMinor} currency={sub.currency} />
            {sub.priceMinorOverride !== null ? <Negotiated /> : null}
          </Term>
          <Term label="Comision pe rezervare">
            {formatBps(sub.platformFeeBps)}
            {sub.feeBpsOverride !== null ? <Negotiated /> : null}
          </Term>
          <Term label="Afiliați incluși">
            {sub.maxAffiliates === null ? 'nelimitat' : `până la ${sub.maxAffiliates}`}
          </Term>
          {sub.trialEndsAt && (sub.status === 'trialing' || sub.status === 'past_due') ? (
            <Term label="Proba se termină">{formatDate(sub.trialEndsAt, PLATFORM_TZ)}</Term>
          ) : null}
          {sub.currentPeriodEnd ? (
            <Term label="Plătit până la">{formatDate(sub.currentPeriodEnd, PLATFORM_TZ)}</Term>
          ) : null}
          <Term label="Facturare">{sub.billedByStripe ? 'card, prin Stripe' : 'manuală'}</Term>
        </dl>
      ) : (
        <p className="text-muted">Operatorul nu are încă un abonament. Alege un plan.</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setEditing(true)}>
          {sub ? 'Schimbă planul sau tarifele' : 'Alege planul'}
        </Button>
        {sub && !sub.billedByStripe ? (
          <Button variant="secondary" icon={<IconCheck />} onClick={() => setPaymentOpen(true)}>
            Înregistrează o plată
          </Button>
        ) : null}
        {sub &&
        (sub.status === 'trialing' || (sub.status === 'past_due' && !sub.currentPeriodEnd)) ? (
          <Button variant="ghost" onClick={() => setTrialOpen(true)}>
            Prelungește proba
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
        onSave={(body) => void save(body, 'Abonamentul a fost actualizat.')}
      />

      <DateDialog
        open={paymentOpen}
        title="Înregistrează o plată"
        description="Abonamentul devine activ până la data aleasă. Folosește-l când operatorul a plătit factura."
        label="Plătit până la"
        initial={dateKeyOf(null, 31)}
        busy={busy}
        error={error}
        submitLabel="Marchează plătit"
        onClose={() => setPaymentOpen(false)}
        onSave={(day) => void save({ paidUntil: endOfDay(day) }, 'Plata a fost înregistrată.')}
        extra={
          sub && sub.status !== 'canceled' ? (
            <Button
              variant="ghost"
              icon={<IconX />}
              disabled={busy}
              onClick={() => void save({ cancel: true }, 'Abonamentul a fost oprit.')}
            >
              Oprește abonamentul
            </Button>
          ) : null
        }
      />

      <DateDialog
        open={trialOpen}
        title="Prelungește perioada de probă"
        label="Proba se termină pe"
        initial={dateKeyOf(sub?.trialEndsAt ?? null, 14)}
        busy={busy}
        error={error}
        submitLabel="Salvează"
        onClose={() => setTrialOpen(false)}
        onSave={(day) => void save({ trialEndsAt: endOfDay(day) }, 'Proba a fost prelungită.')}
      />
    </Card>
  );
}

function Negotiated() {
  return <span className="ml-1.5 text-sm font-normal text-muted">(negociat)</span>;
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const feeBps = fee.trim() ? percentToBps(fee) : null;
    if (fee.trim() && (feeBps === null || feeBps > 5_000)) {
      setFieldError('Comisionul este un procent între 0 și 50.');
      return;
    }
    const priceMinor = price.trim() ? parseMoneyInput(price, currency) : null;
    if (price.trim() && priceMinor === null) {
      setFieldError('Prețul nu este un număr valid.');
      return;
    }
    setFieldError(null);
    onSave({
      ...(planId && planId !== sub?.planId ? { planId } : {}),
      feeBpsOverride: feeBps,
      priceMinorOverride: priceMinor,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title="Plan și tarife">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <SelectField label="Plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
          {offered.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {minorToInput(p.monthlyPriceMinor, p.currency)} {p.currency}/lună ·{' '}
              {formatBps(p.platformFeeBps)}
            </option>
          ))}
        </SelectField>
        <Field
          label="Comision negociat pe rezervare (%)"
          hint={`Gol = comisionul planului${plan ? ` (${formatBps(plan.platformFeeBps)})` : ''}.`}
          inputMode="decimal"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          placeholder={plan ? bpsToPercentInput(plan.platformFeeBps) : ''}
        />
        <Field
          label={`Preț lunar negociat (${currency})`}
          hint={`Gol = prețul planului${plan ? ` (${minorToInput(plan.monthlyPriceMinor, plan.currency)} ${plan.currency})` : ''}.`}
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          error={fieldError ?? undefined}
        />
        <p className="text-sm text-muted">
          Comisionul nou se aplică rezervărilor făcute de acum înainte.
        </p>
        <Button type="submit" loading={busy} size="lg">
          Salvează
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
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setError('Scrie motivul (cel puțin 3 caractere).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(await adminApi.setStatus(tenant.id, { status: 'suspended', reason: reason.trim() }));
      setReason('');
    } catch (err) {
      setError(errorMessageRo(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Suspenzi ${tenant.name}?`}
      description="Operatorul și personalul lui nu mai pot intra în administrare, afiliații nu mai pot rezerva, iar paginile publice de rezervare se opresc. Rezervările deja plătite rămân valabile."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextareaField
          label="Motiv"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="De exemplu: abonament neplătit din septembrie"
          error={error ?? undefined}
          rows={3}
        />
        <Button type="submit" variant="danger" loading={busy} size="lg">
          Suspendă
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
            setError(errorMessageRo(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        Reactivează operatorul
      </Button>
      {error ? <p className="text-sm">{error}</p> : null}
    </div>
  );
}
