'use client';

import type { OperatorInviteDto } from '@ap/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field, SelectField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { ShareActions } from '@/components/ShareActions';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { isValidEmail, normalizeEmail } from '@/lib/contact';
import { formatDate } from '@/lib/dates';
import { formatBps, percentToBps } from '@/lib/format';
import { adminApi } from '@/lib/platform-endpoints';
import { INVITE_STATUS } from '@/lib/platform-labels';
import { errorMessageRo, useApi } from '@/lib/useApi';

const PLATFORM_TZ = 'Europe/Bucharest';

export function InvitesAdmin() {
  const invites = useApi('admin-invites', (signal) => adminApi.invites({ signal }));
  const plans = useApi('admin-plans', (signal) => adminApi.plans({ signal }));
  const [created, setCreated] = useState<OperatorInviteDto | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Invitații"
        description="Invită un operator: primește pe email un link cu care își deschide contul, cu planul și tarifele stabilite de tine."
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {created ? (
            <Card title="Invitația a fost trimisă">
              <p className="mb-3 text-muted">
                Am trimis linkul pe {created.email}. Îl poți trimite și pe WhatsApp; funcționează
                doar cu această adresă de email și expiră pe{' '}
                {formatDate(created.expiresAt, PLATFORM_TZ)}.
              </p>
              <p className="mb-3 break-all rounded-xl bg-surface-2 p-3 font-mono text-sm">
                {created.inviteUrl}
              </p>
              <ShareActions
                url={created.inviteUrl!}
                title={`Invitație ${created.businessName}`}
                text={`Deschide contul ${created.businessName} pe platforma de afiliere:`}
              />
              <Button variant="ghost" className="mt-2" onClick={() => setCreated(null)}>
                Invită alt operator
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

        <Card title="Trimise">
          {invites.error ? <Alert tone="error">{errorMessageRo(invites.error)}</Alert> : null}
          {invites.loading && !invites.data ? <LoadingBlock /> : null}
          {invites.data && invites.data.length === 0 ? (
            <p className="text-muted">Nicio invitație încă.</p>
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
  const [busy, setBusy] = useState(false);
  const status = INVITE_STATUS[invite.status];
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
          {invite.email} · {invite.planName ?? 'plan implicit'}
          {invite.feeBpsOverride !== null ? ` · ${formatBps(invite.feeBpsOverride)}` : ''}
          {invite.trialDays !== null ? ` · ${invite.trialDays} zile probă` : ''}
        </p>
        <p className="text-sm text-muted">Trimisă pe {formatDate(invite.createdAt, PLATFORM_TZ)}</p>
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
            Anulează
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
  const [email, setEmail] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [planId, setPlanId] = useState('');
  const [fee, setFee] = useState('');
  const [trialDays, setTrialDays] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = plans.find((p) => p.id === planId) ?? plans.find((p) => p.isDefault) ?? plans[0];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    const cleanEmail = normalizeEmail(email);
    const feeBps = fee.trim() ? percentToBps(fee) : null;
    const trial = trialDays.trim() ? Number(trialDays) : null;
    if (!isValidEmail(cleanEmail)) next.email = 'Scrie o adresă de email validă.';
    if (businessName.trim().length < 2) next.businessName = 'Scrie numele afacerii.';
    if (fee.trim() && (feeBps === null || feeBps > 5_000)) next.fee = 'Un procent între 0 și 50.';
    if (trial !== null && (!Number.isInteger(trial) || trial < 0 || trial > 365))
      next.trial = 'Între 0 și 365 de zile.';
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
      setError(errorMessageRo(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Invită un operator">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field
          label="Numele afacerii"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder="Delta Boat Tours"
          error={errors.businessName}
        />
        <Field
          label="Emailul operatorului"
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <SelectField label="Plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
          <option value="">
            Planul implicit
            {plans.find((p) => p.isDefault) ? ` (${plans.find((p) => p.isDefault)!.name})` : ''}
          </option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Comision negociat (%)"
            hint={plan ? `Gol = ${formatBps(plan.platformFeeBps)}` : undefined}
            inputMode="decimal"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            error={errors.fee}
          />
          <Field
            label="Zile de probă"
            hint={plan ? `Gol = ${plan.trialDays}` : undefined}
            inputMode="numeric"
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
            error={errors.trial}
          />
        </div>
        <Button type="submit" size="lg" loading={busy}>
          Trimite invitația
        </Button>
      </form>
    </Card>
  );
}
