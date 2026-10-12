'use client';

import type { CreatePlatformPlanBody, PlatformPlanDto } from '@ap/contracts';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { Field, SelectField, TextareaField } from '@/components/Field';
import { IconPlus } from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import {
  bpsToPercentInput,
  formatBps,
  minorToInput,
  parseMoneyInput,
  percentToBps,
} from '@/lib/format';
import { pluralRo } from '@/lib/i18n';
import { adminApi } from '@/lib/platform-endpoints';
import { errorMessageRo, useApi } from '@/lib/useApi';

export function PlansAdmin() {
  const plans = useApi('admin-plans', (signal) => adminApi.plans({ signal }));
  const [editing, setEditing] = useState<PlatformPlanDto | 'new' | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Planuri și tarife"
        description="Ce plătesc operatorii: un abonament lunar și un procent din fiecare rezervare. Poți negocia tarife speciale pe fiecare operator."
        actions={
          <Button icon={<IconPlus />} onClick={() => setEditing('new')}>
            Plan nou
          </Button>
        }
      />
      {plans.error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={plans.reload}>
              Încearcă din nou
            </Button>
          }
        >
          {errorMessageRo(plans.error)}
        </Alert>
      ) : null}
      {plans.loading && !plans.data ? <LoadingBlock /> : null}
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(plans.data ?? []).map((plan) => (
          <li key={plan.id}>
            <Card className="h-full">
              <div className="flex h-full flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-bold">{plan.name}</h2>
                    <p className="text-sm text-muted">cod: {plan.code}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {plan.isDefault ? <StatusChip tone="brand">Plan implicit</StatusChip> : null}
                    {!plan.isActive ? <StatusChip>Retras</StatusChip> : null}
                  </div>
                </div>
                {plan.description ? <p className="text-muted">{plan.description}</p> : null}
                <p>
                  <MoneyText
                    amountMinor={plan.monthlyPriceMinor}
                    currency={plan.currency}
                    className="text-2xl font-bold"
                  />
                  <span className="text-muted"> / lună</span>
                  <span className="mx-2 text-muted">+</span>
                  <span className="text-2xl font-bold">{formatBps(plan.platformFeeBps)}</span>
                  <span className="text-muted"> / rezervare</span>
                </p>
                <ul className="text-sm text-muted">
                  <li>
                    {plan.maxAffiliates === null
                      ? 'Afiliați nelimitați'
                      : `Până la ${plan.maxAffiliates} afiliați`}
                  </li>
                  <li>
                    {plan.trialDays
                      ? `${plan.trialDays} zile gratuite la început`
                      : 'Fără perioadă de probă'}
                  </li>
                  <li>
                    {plan.stripePriceId
                      ? `Stripe: ${plan.stripePriceId}`
                      : 'Fără preț Stripe (facturare manuală)'}
                  </li>
                </ul>
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
                  <span className="text-sm font-semibold">
                    {pluralRo(plan.tenantCount, 'operator', 'operatori')}
                  </span>
                  <Button variant="secondary" onClick={() => setEditing(plan)}>
                    Modifică
                  </Button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {editing ? (
        <PlanDialog
          plan={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            plans.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function PlanDialog({
  plan,
  onClose,
  onSaved,
}: {
  plan: PlatformPlanDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [currency, setCurrency] = useState(plan?.currency ?? 'EUR');
  const [price, setPrice] = useState(
    plan ? minorToInput(plan.monthlyPriceMinor, plan.currency) : '',
  );
  const [fee, setFee] = useState(plan ? bpsToPercentInput(plan.platformFeeBps) : '');
  const [trialDays, setTrialDays] = useState(String(plan?.trialDays ?? 14));
  const [maxAffiliates, setMaxAffiliates] = useState(
    plan?.maxAffiliates === null || plan === null ? '' : String(plan.maxAffiliates),
  );
  const [stripePriceId, setStripePriceId] = useState(plan?.stripePriceId ?? '');
  const [isDefault, setIsDefault] = useState(plan?.isDefault ?? false);
  const [isActive, setIsActive] = useState(plan?.isActive ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    const priceMinor = parseMoneyInput(price, currency);
    const feeBps = percentToBps(fee);
    const trial = Number(trialDays);
    const max = maxAffiliates.trim() ? Number(maxAffiliates) : null;
    if (!plan && !/^[a-z0-9-]{2,32}$/.test(code.trim()))
      next.code = 'Litere mici, cifre și cratime.';
    if (!name.trim()) next.name = 'Scrie numele planului.';
    if (priceMinor === null) next.price = 'Prețul nu este un număr valid.';
    if (feeBps === null || feeBps > 5_000) next.fee = 'Un procent între 0 și 50.';
    if (!Number.isInteger(trial) || trial < 0 || trial > 365)
      next.trial = 'Între 0 și 365 de zile.';
    if (max !== null && (!Number.isInteger(max) || max < 1))
      next.max = 'Un număr întreg, sau gol pentru nelimitat.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const body: Omit<CreatePlatformPlanBody, 'code'> = {
      name: name.trim(),
      description: description.trim(),
      monthlyPriceMinor: priceMinor!,
      currency,
      platformFeeBps: feeBps!,
      trialDays: trial,
      maxAffiliates: max,
      stripePriceId: stripePriceId.trim() || null,
      isDefault,
      isActive,
      sortOrder: plan?.sortOrder ?? 0,
    };
    setBusy(true);
    setError(null);
    try {
      if (plan) await adminApi.updatePlan(plan.id, body);
      else await adminApi.createPlan({ ...body, code: code.trim() });
      onSaved();
    } catch (err) {
      setError(errorMessageRo(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={plan ? `Modifică ${plan.name}` : 'Plan nou'}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {plan && plan.tenantCount > 0 ? (
          <Alert tone="info">
            Schimbările se aplică celor {pluralRo(plan.tenantCount, 'operator', 'operatori')} de pe
            plan, pentru rezervările viitoare, cu excepția celor cu tarif negociat.
          </Alert>
        ) : null}
        {!plan ? (
          <Field
            label="Cod"
            hint="Folosit intern, nu se mai poate schimba. De exemplu: business"
            value={code}
            onChange={(e) => setCode(e.target.value.toLowerCase())}
            error={errors.code}
            autoCapitalize="none"
          />
        ) : null}
        <Field
          label="Nume"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <TextareaField
          label="Descriere"
          optionalText="opțional"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field
            label="Abonament lunar"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            error={errors.price}
          />
          <SelectField
            label="Moneda"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {['EUR', 'RON', 'USD', 'GBP'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </SelectField>
        </div>
        <Field
          label="Comision pe rezervare (%)"
          inputMode="decimal"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          error={errors.fee}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Zile de probă"
            inputMode="numeric"
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
            error={errors.trial}
          />
          <Field
            label="Maxim afiliați"
            hint="Gol = nelimitat"
            inputMode="numeric"
            value={maxAffiliates}
            onChange={(e) => setMaxAffiliates(e.target.value)}
            error={errors.max}
          />
        </div>
        <Field
          label="Preț Stripe"
          optionalText="opțional"
          hint="ID-ul prețului recurent din Stripe (price_…), pentru plata cu cardul."
          value={stripePriceId}
          onChange={(e) => setStripePriceId(e.target.value)}
          autoCapitalize="none"
        />
        <label className="flex min-h-12 items-center gap-3">
          <input
            type="checkbox"
            className="size-5"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          <span>Plan implicit pentru operatorii care se înscriu singuri</span>
        </label>
        <label className="flex min-h-12 items-center gap-3">
          <input
            type="checkbox"
            className="size-5"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span>Oferit operatorilor noi</span>
        </label>
        <Button type="submit" size="lg" loading={busy}>
          {plan ? 'Salvează' : 'Creează planul'}
        </Button>
      </form>
    </Dialog>
  );
}
