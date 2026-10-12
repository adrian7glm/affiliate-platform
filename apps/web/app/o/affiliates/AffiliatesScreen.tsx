'use client';

import type { AffiliateDto, AffiliateWithStatsDto, CommissionPlanDto } from '@ap/contracts';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { ChoiceGroup, Field, SelectField } from '@/components/Field';
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
import { pluralRo } from '@/lib/i18n';
import { AFFILIATE_STATUS } from '@/lib/labels';
import { whatsappUrl } from '@/lib/share';
import { errorMessageRo, useApi } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';

function planSummary(plan: CommissionPlanDto | undefined): string {
  if (!plan) return 'Planul implicit';
  if (plan.kind === 'fixed') return `${plan.name} · ${formatBps(plan.rateBps ?? 0)}`;
  const rates = (plan.tiers ?? []).map((t) => formatBps(t.rateBps));
  return `${plan.name} · ${rates.join(' → ')}`;
}

export function AffiliatesScreen() {
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
      setRowError(errorMessageRo(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Afiliați"
        description="Recepționeri, concierge și ghizi care îți recomandă excursiile."
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
              Încearcă din nou
            </Button>
          }
        >
          {errorMessageRo(affiliates.error)}
        </Alert>
      ) : null}
      {rowError ? <Alert tone="error">{rowError}</Alert> : null}

      {affiliates.data ? (
        <section aria-labelledby="affiliates-title" className="flex flex-col gap-3">
          <h2 id="affiliates-title" className="text-xl font-semibold">
            {pluralRo(affiliates.data.length, 'afiliat', 'afiliați')}
            {affiliates.data[0] ? (
              <span className="ml-2 text-base font-normal text-muted">
                · {formatPeriod(affiliates.data[0].month.periodKey)}
              </span>
            ) : null}
          </h2>
          {affiliates.data.length === 0 ? (
            <p className="text-muted">Încă nu ai afiliați. Invită primul afiliat mai sus.</p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {affiliates.data.map((affiliate) => {
                const status = AFFILIATE_STATUS[affiliate.status];
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
                              {affiliate.type === 'organization' ? 'Organizație' : 'Persoană'}
                            </p>
                          </div>
                          <StatusChip tone={status.tone}>{status.label}</StatusChip>
                        </div>
                        <dl className="grid grid-cols-2 gap-2 text-sm">
                          <div className="rounded-xl bg-surface-2 p-2.5">
                            <dt className="text-muted">Vânzări luna aceasta</dt>
                            <dd className="text-lg font-bold tabular-nums">
                              {affiliate.month.paidSales}
                            </dd>
                          </div>
                          <div className="rounded-xl bg-surface-2 p-2.5">
                            <dt className="text-muted">Comision câștigat</dt>
                            <dd className="text-lg font-bold">
                              <MoneyText
                                amountMinor={affiliate.month.earnedMinor}
                                currency={affiliate.month.currency || tenant.currency}
                              />
                            </dd>
                          </div>
                          <div className="col-span-2">
                            <dt className="text-muted">Comision</dt>
                            <dd>
                              {affiliate.commissionRateBpsOverride !== null
                                ? `${formatBps(affiliate.commissionRateBpsOverride)} (procent personalizat)`
                                : planSummary(plan)}
                            </dd>
                          </div>
                        </dl>
                        <div className="mt-auto flex flex-wrap gap-2">
                          <Button variant="secondary" onClick={() => setEditing(affiliate)}>
                            Modifică
                          </Button>
                          {affiliate.status !== 'invited' ? (
                            <Button
                              variant={affiliate.status === 'suspended' ? 'secondary' : 'ghost'}
                              loading={busyId === affiliate.id}
                              onClick={() => void toggleSuspend(affiliate)}
                            >
                              {affiliate.status === 'suspended' ? 'Reactivează' : 'Suspendă'}
                            </Button>
                          ) : affiliate.inviteUrl ? (
                            <Button
                              variant="ghost"
                              icon={<IconQr />}
                              onClick={() => setInvited(affiliate)}
                            >
                              Arată invitația
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

      <Dialog open={!!invited} onClose={() => setInvited(null)} title="Invitația este gata">
        {invited?.inviteUrl ? (
          <div className="flex flex-col gap-4">
            <p>
              Trimite linkul lui <strong>{invited.displayName}</strong> sau lasă-l să scaneze codul
              cu telefonul.
            </p>
            <QrCode
              value={invited.inviteUrl}
              label={`Cod QR de invitație pentru ${invited.displayName}`}
              className="mx-auto w-full max-w-72"
            />
            <p className="break-all rounded-xl bg-surface-2 px-3 py-2 font-mono text-sm">
              {invited.inviteUrl}
            </p>
            <ShareActions
              url={invited.inviteUrl}
              title="Invitație"
              text={`Invitație de afiliat la ${tenant.name}:`}
              size="md"
            />
            <ButtonLink
              href={whatsappUrl(`Te invit să devii afiliat ${tenant.name}: ${invited.inviteUrl}`)}
              external
              target="_blank"
              rel="noopener noreferrer"
              variant="secondary"
              icon={<IconChat />}
              block
            >
              Trimite pe WhatsApp
            </ButtonLink>
          </div>
        ) : (
          <p>Afiliatul a fost adăugat.</p>
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
    if (!displayName.trim()) next.name = 'Scrie numele afiliatului.';
    if (destination.trim()) {
      cleanDestination = destination.includes('@')
        ? normalizeEmail(destination)
        : normalizePhone(destination);
      const ok = destination.includes('@')
        ? isValidEmail(cleanDestination)
        : isValidPhone(cleanDestination);
      if (!ok) next.destination = 'Scrie un email sau un număr de telefon valid, ex. 0722 123 456.';
    }
    let overrideBps: number | null = null;
    if (override.trim()) {
      overrideBps = percentToBps(override);
      if (overrideBps === null) next.override = 'Scrie un procent între 0 și 100, ex. 12,5.';
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
      setError(errorMessageRo(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="invite" className="scroll-mt-20">
      <Card
        title="Invită un afiliat"
        description="Primești un link și un cod QR de trimis afiliatului."
      >
        <form onSubmit={submit} method="post" noValidate className="grid gap-4 md:grid-cols-2">
          <Field
            label="Nume"
            hint="Persoana sau hotelul, ex. „Maria – Hotel Delta”."
            name="displayName"
            autoComplete="off"
            required
            maxLength={120}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            error={errors.name}
          />
          <Field
            label="Telefon sau email"
            hint="Dacă îl completezi, îi trimitem invitația direct."
            name="destination"
            optionalText="opțional"
            autoComplete="off"
            inputMode="email"
            autoCapitalize="off"
            spellCheck={false}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            error={errors.destination}
          />
          <ChoiceGroup
            legend="Tip"
            name="type"
            value={type}
            onChange={setType}
            gridClassName="grid grid-cols-2 gap-2"
            options={[
              { value: 'person', label: 'Persoană' },
              { value: 'organization', label: 'Organizație' },
            ]}
          />
          <SelectField
            label="Plan de comision"
            name="planId"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
          >
            <option value="">Planul implicit</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {planSummary(p)}
              </option>
            ))}
          </SelectField>
          <Field
            label="Procent personalizat"
            hint="Înlocuiește planul pentru acest afiliat."
            name="override"
            optionalText="opțional"
            inputMode="decimal"
            autoComplete="off"
            placeholder="ex. 12,5"
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
              loadingText="Se creează…"
              className="md:self-start"
            >
              Creează invitația
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
  return (
    <Dialog
      open={!!affiliate}
      onClose={onClose}
      title={affiliate ? `Modifică: ${affiliate.displayName}` : ''}
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
    if (!displayName.trim()) next.name = 'Numele nu poate fi gol.';
    let overrideBps: number | null = null;
    if (override.trim()) {
      overrideBps = percentToBps(override);
      if (overrideBps === null) next.override = 'Scrie un procent între 0 și 100, ex. 12,5.';
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
      setError(errorMessageRo(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-4">
      <Field
        label="Nume"
        name="displayName"
        autoComplete="off"
        required
        maxLength={120}
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        error={errors.name}
      />
      <SelectField
        label="Plan de comision"
        name="planId"
        value={planId}
        onChange={(e) => setPlanId(e.target.value)}
      >
        <option value="">Planul implicit</option>
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {planSummary(p)}
          </option>
        ))}
      </SelectField>
      <Field
        label="Procent personalizat"
        hint="Lasă gol ca să se aplice planul."
        name="override"
        optionalText="opțional"
        inputMode="decimal"
        autoComplete="off"
        value={override}
        onChange={(e) => setOverride(e.target.value)}
        error={errors.override}
      />
      {affiliate.status !== 'invited' ? (
        <ChoiceGroup
          legend="Stare"
          name="status"
          value={status}
          onChange={setStatus}
          gridClassName="grid grid-cols-2 gap-2"
          options={[
            { value: 'active', label: 'Activ' },
            {
              value: 'suspended',
              label: 'Suspendat',
              description: 'Linkurile lui se opresc; nu primește comision nou',
            },
          ]}
        />
      ) : (
        <p className="text-sm text-muted">Afiliatul nu a acceptat încă invitația.</p>
      )}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" size="lg" block loading={busy} loadingText="Se salvează…">
        Salvează
      </Button>
    </form>
  );
}
