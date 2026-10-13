'use client';

import type { AffiliateDto, AffiliateWithStatsDto, CommissionPlanDto } from '@ap/contracts';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { ChoiceGroup, Field, SelectField } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { IconChat, IconQr } from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { QrCode } from '@/components/QrCode';
import { ShareActions } from '@/components/ShareActions';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { isValidEmail, isValidPhone, normalizeEmail, normalizePhone } from '@/lib/contact';
import { formatPeriod } from '@/lib/dates';
import { operatorApi } from '@/lib/endpoints';
import { bpsToPercentInput, formatBps, percentToBps } from '@/lib/format';
import type { Translator } from '@/lib/i18n';
import { affiliateStatus } from '@/lib/labels';
import { whatsappUrl } from '@/lib/share';
import { errorMessage, useApi } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';
import { Rich, slots } from '../Rich';

function planSummary(plan: CommissionPlanDto | undefined, tr: Translator): string {
  if (!plan) return tr.t('operator.affiliates.defaultPlan');
  if (plan.kind === 'fixed') return `${plan.name} · ${formatBps(plan.rateBps ?? 0, tr.lang)}`;
  const rates = (plan.tiers ?? []).map((tier) => formatBps(tier.rateBps, tr.lang));
  return `${plan.name} · ${rates.join(' → ')}`;
}

export function AffiliatesScreen() {
  const tr = useT();
  const { t, tp, lang } = tr;
  const { tenant, dashboard } = useOperator();
  const affiliates = useApi('operator-affiliates', (signal) => operatorApi.affiliates({ signal }));
  const plans = useApi('operator-plans', (signal) => operatorApi.plans({ signal }));
  const [invited, setInvited] = useState<AffiliateDto | null>(null);
  const [editing, setEditing] = useState<AffiliateWithStatsDto | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const planById = new Map((plans.data ?? []).map((p) => [p.id, p]));
  const defaultPlan = plans.data?.find((p) => p.isDefault);

  function mergeAffiliate(updated: AffiliateDto) {
    affiliates.setData((prev) =>
      (prev ?? []).map((a) => (a.id === updated.id ? { ...a, ...updated, month: a.month } : a)),
    );
  }

  async function toggleSuspend(affiliate: AffiliateWithStatsDto) {
    setBusyId(affiliate.id);
    setRowError(null);
    try {
      const updated = await operatorApi.updateAffiliate(affiliate.id, {
        status: affiliate.status === 'suspended' ? 'active' : 'suspended',
      });
      mergeAffiliate(updated);
      dashboard.reload();
    } catch (err) {
      setRowError(errorMessage(err, tr));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('operator.affiliates.title')}
        description={t('operator.affiliates.description')}
      />

      <InviteForm
        plans={plans.data ?? []}
        onInvited={(affiliate) => {
          setInvited(affiliate);
          affiliates.reload();
          dashboard.reload();
        }}
      />

      {affiliates.loading && !affiliates.data ? <LoadingBlock /> : null}
      {affiliates.error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={affiliates.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(affiliates.error, tr)}
        </Alert>
      ) : null}
      {rowError ? <Alert tone="error">{rowError}</Alert> : null}

      {affiliates.data ? (
        <section aria-labelledby="affiliates-title" className="flex flex-col gap-3">
          <h2 id="affiliates-title" className="text-xl font-semibold">
            {tp('operator.affiliates.count', affiliates.data.length)}
            {affiliates.data[0] ? (
              <span className="ml-2 text-base font-normal text-muted">
                · {formatPeriod(affiliates.data[0].month.periodKey, lang)}
              </span>
            ) : null}
          </h2>
          {affiliates.data.length === 0 ? (
            <p className="text-muted">{t('operator.affiliates.empty')}</p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {affiliates.data.map((affiliate) => {
                const status = affiliateStatus(tr, affiliate.status);
                const plan = affiliate.commissionPlanId
                  ? planById.get(affiliate.commissionPlanId)
                  : defaultPlan;
                return (
                  <li key={affiliate.id}>
                    <Card className="h-full">
                      <div className="flex h-full flex-col gap-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="text-lg font-semibold">{affiliate.displayName}</h3>
                            <p className="text-sm text-muted">
                              {affiliate.type === 'organization'
                                ? t('operator.affiliates.typeOrganization')
                                : t('operator.affiliates.typePerson')}
                            </p>
                          </div>
                          <StatusChip tone={status.tone}>{status.label}</StatusChip>
                        </div>
                        <dl className="grid grid-cols-2 gap-2 text-sm">
                          <div className="rounded-xl bg-surface-2 p-2.5">
                            <dt className="text-muted">
                              {t('operator.affiliates.salesThisMonth')}
                            </dt>
                            <dd className="text-lg font-bold tabular-nums">
                              {affiliate.month.paidSales}
                            </dd>
                          </div>
                          <div className="rounded-xl bg-surface-2 p-2.5">
                            <dt className="text-muted">{t('operator.affiliates.earned')}</dt>
                            <dd className="text-lg font-bold">
                              <MoneyText
                                amountMinor={affiliate.month.earnedMinor}
                                currency={affiliate.month.currency || tenant.currency}
                              />
                            </dd>
                          </div>
                          <div className="col-span-2">
                            <dt className="text-muted">{t('operator.affiliates.commission')}</dt>
                            <dd>
                              {affiliate.commissionRateBpsOverride !== null
                                ? t('operator.affiliates.customRate', {
                                    rate: formatBps(affiliate.commissionRateBpsOverride, lang),
                                  })
                                : planSummary(plan, tr)}
                            </dd>
                          </div>
                        </dl>
                        <div className="mt-auto flex flex-wrap gap-2">
                          <Button variant="secondary" onClick={() => setEditing(affiliate)}>
                            {t('operator.affiliates.edit')}
                          </Button>
                          {affiliate.status !== 'invited' ? (
                            <Button
                              variant={affiliate.status === 'suspended' ? 'secondary' : 'ghost'}
                              loading={busyId === affiliate.id}
                              onClick={() => void toggleSuspend(affiliate)}
                            >
                              {affiliate.status === 'suspended'
                                ? t('operator.affiliates.reactivate')
                                : t('operator.affiliates.suspend')}
                            </Button>
                          ) : affiliate.inviteUrl ? (
                            <Button
                              variant="ghost"
                              icon={<IconQr />}
                              onClick={() => setInvited(affiliate)}
                            >
                              {t('operator.affiliates.showInvite')}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      <Dialog
        open={!!invited}
        onClose={() => setInvited(null)}
        title={t('operator.affiliates.inviteReady')}
      >
        {invited?.inviteUrl ? (
          <div className="flex flex-col gap-4">
            <p>
              <Rich
                text={t('operator.affiliates.sendLink', slots('name'))}
                parts={{ name: <strong>{invited.displayName}</strong> }}
              />
            </p>
            <QrCode
              value={invited.inviteUrl}
              label={t('operator.affiliates.qrLabel', { name: invited.displayName })}
              className="mx-auto w-full max-w-72"
            />
            <p className="break-all rounded-xl bg-surface-2 px-3 py-2 font-mono text-sm">
              {invited.inviteUrl}
            </p>
            <ShareActions
              url={invited.inviteUrl}
              title={t('operator.affiliates.shareTitle')}
              text={t('operator.affiliates.shareText', { tenant: tenant.name })}
              size="md"
            />
            <ButtonLink
              href={whatsappUrl(
                t('operator.affiliates.whatsappText', {
                  tenant: tenant.name,
                  url: invited.inviteUrl,
                }),
              )}
              external
              target="_blank"
              rel="noopener noreferrer"
              variant="secondary"
              icon={<IconChat />}
              block
            >
              {t('operator.affiliates.whatsapp')}
            </ButtonLink>
          </div>
        ) : (
          <p>{t('operator.affiliates.added')}</p>
        )}
      </Dialog>

      <EditAffiliateDialog
        affiliate={editing}
        plans={plans.data ?? []}
        onClose={() => setEditing(null)}
        onSaved={(updated) => {
          mergeAffiliate(updated);
          setEditing(null);
          dashboard.reload();
        }}
      />
    </div>
  );
}

function InviteForm({
  plans,
  onInvited,
}: {
  plans: CommissionPlanDto[];
  onInvited: (a: AffiliateDto) => void;
}) {
  const tr = useT();
  const { t } = tr;
  const [displayName, setDisplayName] = useState('');
  const [type, setType] = useState<'person' | 'organization'>('person');
  const [destination, setDestination] = useState('');
  const [planId, setPlanId] = useState('');
  const [override, setOverride] = useState('');
  const [errors, setErrors] = useState<{ name?: string; destination?: string; override?: string }>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: typeof errors = {};
    let cleanDestination: string | undefined;
    if (!displayName.trim()) next.name = t('operator.affiliates.nameRequired');
    if (destination.trim()) {
      cleanDestination = destination.includes('@')
        ? normalizeEmail(destination)
        : normalizePhone(destination);
      const ok = destination.includes('@')
        ? isValidEmail(cleanDestination)
        : isValidPhone(cleanDestination);
      if (!ok) next.destination = t('operator.affiliates.destinationInvalid');
    }
    let overrideBps: number | null = null;
    if (override.trim()) {
      overrideBps = percentToBps(override);
      if (overrideBps === null) next.override = t('operator.affiliates.percentInvalid');
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      const affiliate = await operatorApi.inviteAffiliate({
        displayName: displayName.trim(),
        type,
        destination: cleanDestination,
        commissionPlanId: planId || null,
        commissionRateBpsOverride: overrideBps,
      });
      onInvited(affiliate);
      setDisplayName('');
      setDestination('');
      setPlanId('');
      setOverride('');
      setType('person');
    } catch (err) {
      setError(errorMessage(err, tr));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="invite" className="scroll-mt-20">
      <Card
        title={t('operator.affiliates.inviteTitle')}
        description={t('operator.affiliates.inviteDescription')}
      >
        <form onSubmit={submit} method="post" noValidate className="grid gap-4 md:grid-cols-2">
          <Field
            label={t('operator.affiliates.name')}
            hint={t('operator.affiliates.nameHint')}
            name="displayName"
            autoComplete="off"
            required
            maxLength={120}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            error={errors.name}
          />
          <Field
            label={t('operator.affiliates.destination')}
            hint={t('operator.affiliates.destinationHint')}
            name="destination"
            optionalText={t('common.optional')}
            autoComplete="off"
            inputMode="email"
            autoCapitalize="off"
            spellCheck={false}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            error={errors.destination}
          />
          <ChoiceGroup
            legend={t('operator.affiliates.type')}
            name="type"
            value={type}
            onChange={setType}
            gridClassName="grid grid-cols-2 gap-2"
            options={[
              { value: 'person', label: t('operator.affiliates.typePerson') },
              { value: 'organization', label: t('operator.affiliates.typeOrganization') },
            ]}
          />
          <SelectField
            label={t('operator.affiliates.plan')}
            name="planId"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
          >
            <option value="">{t('operator.affiliates.defaultPlan')}</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {planSummary(p, tr)}
              </option>
            ))}
          </SelectField>
          <Field
            label={t('operator.affiliates.customPercent')}
            hint={t('operator.affiliates.customPercentHint')}
            name="override"
            optionalText={t('common.optional')}
            inputMode="decimal"
            autoComplete="off"
            placeholder={t('operator.affiliates.percentPlaceholder')}
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            error={errors.override}
          />
          <div className="flex flex-col justify-end gap-3 md:col-span-2">
            {error ? <Alert tone="error">{error}</Alert> : null}
            <Button
              type="submit"
              size="lg"
              loading={busy}
              loadingText={t('operator.affiliates.creating')}
              className="md:self-start"
            >
              {t('operator.affiliates.create')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function EditAffiliateDialog({
  affiliate,
  plans,
  onClose,
  onSaved,
}: {
  affiliate: AffiliateWithStatsDto | null;
  plans: CommissionPlanDto[];
  onClose: () => void;
  onSaved: (a: AffiliateDto) => void;
}) {
  const { t } = useT();
  return (
    <Dialog
      open={!!affiliate}
      onClose={onClose}
      title={affiliate ? t('operator.affiliates.editTitle', { name: affiliate.displayName }) : ''}
    >
      {affiliate ? (
        <EditAffiliateForm
          key={affiliate.id}
          affiliate={affiliate}
          plans={plans}
          onSaved={onSaved}
        />
      ) : null}
    </Dialog>
  );
}

function EditAffiliateForm({
  affiliate,
  plans,
  onSaved,
}: {
  affiliate: AffiliateWithStatsDto;
  plans: CommissionPlanDto[];
  onSaved: (a: AffiliateDto) => void;
}) {
  const tr = useT();
  const { t } = tr;
  const [displayName, setDisplayName] = useState(affiliate.displayName);
  const [planId, setPlanId] = useState(affiliate.commissionPlanId ?? '');
  const [override, setOverride] = useState(
    affiliate.commissionRateBpsOverride !== null
      ? bpsToPercentInput(affiliate.commissionRateBpsOverride)
      : '',
  );
  const [status, setStatus] = useState<'active' | 'suspended'>(
    affiliate.status === 'suspended' ? 'suspended' : 'active',
  );
  const [errors, setErrors] = useState<{ name?: string; override?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!displayName.trim()) next.name = t('operator.affiliates.nameEmpty');
    let overrideBps: number | null = null;
    if (override.trim()) {
      overrideBps = percentToBps(override);
      if (overrideBps === null) next.override = t('operator.affiliates.percentInvalid');
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await operatorApi.updateAffiliate(affiliate.id, {
        displayName: displayName.trim(),
        commissionPlanId: planId || null,
        commissionRateBpsOverride: overrideBps,
        ...(affiliate.status === 'invited' ? {} : { status }),
      });
      onSaved(updated);
    } catch (err) {
      setError(errorMessage(err, tr));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-4">
      <Field
        label={t('operator.affiliates.name')}
        name="displayName"
        autoComplete="off"
        required
        maxLength={120}
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        error={errors.name}
      />
      <SelectField
        label={t('operator.affiliates.plan')}
        name="planId"
        value={planId}
        onChange={(e) => setPlanId(e.target.value)}
      >
        <option value="">{t('operator.affiliates.defaultPlan')}</option>
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {planSummary(p, tr)}
          </option>
        ))}
      </SelectField>
      <Field
        label={t('operator.affiliates.customPercent')}
        hint={t('operator.affiliates.customPercentEditHint')}
        name="override"
        optionalText={t('common.optional')}
        inputMode="decimal"
        autoComplete="off"
        value={override}
        onChange={(e) => setOverride(e.target.value)}
        error={errors.override}
      />
      {affiliate.status !== 'invited' ? (
        <ChoiceGroup
          legend={t('operator.affiliates.status')}
          name="status"
          value={status}
          onChange={setStatus}
          gridClassName="grid grid-cols-2 gap-2"
          options={[
            { value: 'active', label: affiliateStatus(tr, 'active').label },
            {
              value: 'suspended',
              label: affiliateStatus(tr, 'suspended').label,
              description: t('operator.affiliates.suspendedDescription'),
            },
          ]}
        />
      ) : (
        <p className="text-sm text-muted">{t('operator.affiliates.notAccepted')}</p>
      )}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" size="lg" block loading={busy} loadingText={t('common.saving')}>
        {t('common.save')}
      </Button>
    </form>
  );
}
