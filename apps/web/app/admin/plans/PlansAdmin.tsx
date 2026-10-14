'use client';

import type { CreatePlatformPlanBody, PlatformPlanDto } from '@ap/contracts';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { Field, SelectField, TextareaField } from '@/components/Field';
import { planDescription } from '@/lib/platform-labels';
import { useT } from '@/components/I18nProvider';
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
import { adminApi } from '@/lib/platform-endpoints';
import { errorMessage, useApi } from '@/lib/useApi';

export function PlansAdmin() {
  const i18n = useT();
  const { t, tp, lang } = i18n;
  const plans = useApi('admin-plans', (signal) => adminApi.plans({ signal }));
  const [editing, setEditing] = useState<PlatformPlanDto | 'new' | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('admin.plans.title')}
        description={t('admin.plans.description')}
        actions={
          <Button icon={<IconPlus />} onClick={() => setEditing('new')}>
            {t('admin.plans.new')}
          </Button>
        }
      />
      {plans.error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={plans.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(plans.error, i18n)}
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
                    <p className="text-sm text-muted">
                      {t('admin.plans.code', { code: plan.code })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {plan.isDefault ? (
                      <StatusChip tone="brand">{t('admin.plans.defaultChip')}</StatusChip>
                    ) : null}
                    {!plan.isActive ? <StatusChip>{t('admin.plans.retired')}</StatusChip> : null}
                  </div>
                </div>
                {plan.description ? (
                  <p className="text-muted">{planDescription(i18n, plan)}</p>
                ) : null}
                <p>
                  <MoneyText
                    amountMinor={plan.monthlyPriceMinor}
                    currency={plan.currency}
                    lang={lang}
                    className="text-2xl font-bold"
                  />
                  <span className="text-muted"> {t('admin.plans.perMonth')}</span>
                  <span className="mx-2 text-muted">+</span>
                  <span className="text-2xl font-bold">{formatBps(plan.platformFeeBps, lang)}</span>
                  <span className="text-muted"> {t('admin.plans.perBooking')}</span>
                </p>
                <ul className="text-sm text-muted">
                  <li>
                    {plan.maxAffiliates === null
                      ? t('admin.plans.unlimitedAffiliates')
                      : tp('admin.plans.upToAffiliates', plan.maxAffiliates)}
                  </li>
                  <li>
                    {plan.trialDays
                      ? tp('admin.plans.freeDays', plan.trialDays)
                      : t('admin.plans.noTrial')}
                  </li>
                  <li>
                    {plan.stripePriceId
                      ? t('admin.plans.stripe', { id: plan.stripePriceId })
                      : t('admin.plans.noStripe')}
                  </li>
                </ul>
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
                  <span className="text-sm font-semibold">
                    {tp('admin.count.operators', plan.tenantCount)}
                  </span>
                  <Button variant="secondary" onClick={() => setEditing(plan)}>
                    {t('admin.plans.edit')}
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
  const i18n = useT();
  const { t, tp } = i18n;
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
    if (!plan && !/^[a-z0-9-]{2,32}$/.test(code.trim())) next.code = t('admin.plans.codeError');
    if (!name.trim()) next.name = t('admin.plans.nameError');
    if (priceMinor === null) next.price = t('admin.validation.price');
    if (feeBps === null || feeBps > 5_000) next.fee = t('admin.validation.percent50');
    if (!Number.isInteger(trial) || trial < 0 || trial > 365)
      next.trial = t('admin.validation.trialDays');
    if (max !== null && (!Number.isInteger(max) || max < 1)) next.max = t('admin.plans.maxError');
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
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={plan ? t('admin.plans.editTitle', { name: plan.name }) : t('admin.plans.new')}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {plan && plan.tenantCount > 0 ? (
          <Alert tone="info">{tp('admin.plans.appliesTo', plan.tenantCount)}</Alert>
        ) : null}
        {!plan ? (
          <Field
            label={t('admin.plans.codeLabel')}
            hint={t('admin.plans.codeHint')}
            value={code}
            onChange={(e) => setCode(e.target.value.toLowerCase())}
            error={errors.code}
            autoCapitalize="none"
          />
        ) : null}
        <Field
          label={t('admin.plans.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <TextareaField
          label={t('admin.plans.descriptionLabel')}
          optionalText={t('admin.plans.optional')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field
            label={t('admin.plans.monthly')}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            error={errors.price}
          />
          <SelectField
            label={t('admin.plans.currency')}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {['EUR', 'RON', 'USD', 'GBP'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </SelectField>
        </div>
        <Field
          label={t('admin.plans.fee')}
          inputMode="decimal"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          error={errors.fee}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('admin.plans.trialDays')}
            inputMode="numeric"
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
            error={errors.trial}
          />
          <Field
            label={t('admin.plans.maxAffiliates')}
            hint={t('admin.plans.maxHint')}
            inputMode="numeric"
            value={maxAffiliates}
            onChange={(e) => setMaxAffiliates(e.target.value)}
            error={errors.max}
          />
        </div>
        <Field
          label={t('admin.plans.stripePrice')}
          optionalText={t('admin.plans.optional')}
          hint={t('admin.plans.stripeHint')}
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
          <span>{t('admin.plans.isDefault')}</span>
        </label>
        <label className="flex min-h-12 items-center gap-3">
          <input
            type="checkbox"
            className="size-5"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span>{t('admin.plans.isActive')}</span>
        </label>
        <Button type="submit" size="lg" loading={busy}>
          {plan ? t('admin.plans.save') : t('admin.plans.create')}
        </Button>
      </form>
    </Dialog>
  );
}
