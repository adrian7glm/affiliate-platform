'use client';

import type { OperatorInviteDto } from '@ap/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field, SelectField } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { PageHeader } from '@/components/PageHeader';
import { ShareActions } from '@/components/ShareActions';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { isValidEmail, normalizeEmail } from '@/lib/contact';
import { formatDate } from '@/lib/dates';
import { formatBps, percentToBps } from '@/lib/format';
import { adminApi } from '@/lib/platform-endpoints';
import { inviteStatus } from '@/lib/platform-labels';
import { errorMessage, useApi } from '@/lib/useApi';

const PLATFORM_TZ = 'Europe/Bucharest';

export function InvitesAdmin() {
  const i18n = useT();
  const { t, lang } = i18n;
  const invites = useApi('admin-invites', (signal) => adminApi.invites({ signal }));
  const plans = useApi('admin-plans', (signal) => adminApi.plans({ signal }));
  const [created, setCreated] = useState<OperatorInviteDto | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('admin.invites.title')}
        description={t('admin.invites.description')}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {created ? (
            <Card title={t('admin.invites.sentTitle')}>
              <p className="mb-3 text-muted">
                {t('admin.invites.sentBody', {
                  email: created.email,
                  date: formatDate(created.expiresAt, PLATFORM_TZ, lang),
                })}
              </p>
              <p className="mb-3 break-all rounded-xl bg-surface-2 p-3 font-mono text-sm">
                {created.inviteUrl}
              </p>
              <ShareActions
                url={created.inviteUrl!}
                title={t('admin.invites.shareTitle', { business: created.businessName })}
                text={t('admin.invites.shareText', { business: created.businessName })}
              />
              <Button variant="ghost" className="mt-2" onClick={() => setCreated(null)}>
                {t('admin.invites.inviteAnother')}
              </Button>
            </Card>
          ) : (
            <InviteForm
              plans={(plans.data ?? []).filter((p) => p.isActive)}
              onCreated={(invite) => {
                setCreated(invite);
                invites.reload();
              }}
            />
          )}
        </div>

        <Card title={t('admin.invites.listTitle')}>
          {invites.error ? (
            <Alert tone="error">{errorMessage(invites.error, i18n)}</Alert>
          ) : null}
          {invites.loading && !invites.data ? <LoadingBlock /> : null}
          {invites.data && invites.data.length === 0 ? (
            <p className="text-muted">{t('admin.invites.empty')}</p>
          ) : null}
          <ul className="divide-y divide-line">
            {(invites.data ?? []).map((invite) => (
              <InviteRow key={invite.id} invite={invite} onChanged={invites.reload} />
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function InviteRow({ invite, onChanged }: { invite: OperatorInviteDto; onChanged: () => void }) {
  const i18n = useT();
  const { t, tp, lang } = i18n;
  const [busy, setBusy] = useState(false);
  const status = inviteStatus(i18n, invite.status);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="font-semibold">
          {invite.tenantId ? (
            <Link
              href={`/admin/operators/${invite.tenantId}`}
              className="text-brand hover:underline"
            >
              {invite.businessName}
            </Link>
          ) : (
            invite.businessName
          )}
        </p>
        <p className="truncate text-sm text-muted">
          {[
            invite.email,
            invite.planName ?? t('admin.invites.defaultPlanShort'),
            invite.feeBpsOverride !== null ? formatBps(invite.feeBpsOverride, lang) : null,
            invite.trialDays !== null ? tp('admin.invites.trialDays', invite.trialDays) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="text-sm text-muted">
          {t('admin.invites.sentOn', { date: formatDate(invite.createdAt, PLATFORM_TZ, lang) })}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <StatusChip tone={status.tone}>{status.label}</StatusChip>
        {invite.status === 'pending' ? (
          <Button
            variant="ghost"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await adminApi.revokeInvite(invite.id);
                onChanged();
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('admin.invites.revoke')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function InviteForm({
  plans,
  onCreated,
}: {
  plans: {
    id: string;
    name: string;
    platformFeeBps: number;
    trialDays: number;
    isDefault: boolean;
  }[];
  onCreated: (invite: OperatorInviteDto) => void;
}) {
  const i18n = useT();
  const { t, lang } = i18n;
  const [email, setEmail] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [planId, setPlanId] = useState('');
  const [fee, setFee] = useState('');
  const [trialDays, setTrialDays] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const defaultPlan = plans.find((p) => p.isDefault);
  const plan = plans.find((p) => p.id === planId) ?? defaultPlan ?? plans[0];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    const cleanEmail = normalizeEmail(email);
    const feeBps = fee.trim() ? percentToBps(fee) : null;
    const trial = trialDays.trim() ? Number(trialDays) : null;
    if (!isValidEmail(cleanEmail)) next.email = t('admin.invites.emailError');
    if (businessName.trim().length < 2) next.businessName = t('admin.validation.businessName');
    if (fee.trim() && (feeBps === null || feeBps > 5_000))
      next.fee = t('admin.validation.percent50');
    if (trial !== null && (!Number.isInteger(trial) || trial < 0 || trial > 365))
      next.trial = t('admin.validation.trialDays');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const invite = await adminApi.createInvite({
        email: cleanEmail,
        businessName: businessName.trim(),
        planId: planId || null,
        feeBpsOverride: feeBps,
        trialDays: trial,
      });
      setEmail('');
      setBusinessName('');
      setFee('');
      setTrialDays('');
      onCreated(invite);
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t('admin.invites.formTitle')}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field
          label={t('admin.invites.businessName')}
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder={t('admin.invites.businessPlaceholder')}
          error={errors.businessName}
        />
        <Field
          label={t('admin.invites.email')}
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <SelectField label={t('admin.invites.plan')} value={planId} onChange={(e) => setPlanId(e.target.value)}>
          <option value="">
            {defaultPlan
              ? t('admin.invites.defaultPlanNamed', { name: defaultPlan.name })
              : t('admin.invites.defaultPlan')}
          </option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('admin.invites.fee')}
            hint={
              plan
                ? t('admin.validation.emptyMeans', { value: formatBps(plan.platformFeeBps, lang) })
                : undefined
            }
            inputMode="decimal"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            error={errors.fee}
          />
          <Field
            label={t('admin.invites.trialDaysLabel')}
            hint={
              plan ? t('admin.validation.emptyMeans', { value: plan.trialDays }) : undefined
            }
            inputMode="numeric"
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
            error={errors.trial}
          />
        </div>
        <Button type="submit" size="lg" loading={busy}>
          {t('admin.invites.submit')}
        </Button>
      </form>
    </Card>
  );
}
