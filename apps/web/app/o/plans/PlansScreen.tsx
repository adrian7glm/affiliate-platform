'use client';

import type { CommissionPlanDto, CreatePlanBody } from '@ap/contracts';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { ChoiceGroup, Field, INPUT_CLASSES } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { IconPlus, IconX } from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { planModeExplanation, tierRows } from '@/lib/commission';
import { operatorApi } from '@/lib/endpoints';
import { bpsToPercentInput, formatBps, percentToBps } from '@/lib/format';
import { newTierRow, validateTiers, type TierDraft } from '@/lib/plans';
import type { MessageKey } from '@/lib/i18n';
import { errorMessage, useApi } from '@/lib/useApi';

type Kind = 'fixed' | 'tiered';
type Mode = 'marginal' | 'retroactive';
type Basis = 'gross' | 'net_of_tax';

const BASIS_LABEL: Record<Basis, MessageKey> = {
  gross: 'operator.plans.basisGrossShort',
  net_of_tax: 'operator.plans.basisNetShort',
};

export function PlansScreen() {
  const tr = useT();
  const { t, tp } = tr;
  const plans = useApi('operator-plans', (signal) => operatorApi.plans({ signal }));
  const [editing, setEditing] = useState<CommissionPlanDto | null>(null);
  const [archiving, setArchiving] = useState<CommissionPlanDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const defaultPlan = plans.data?.find((p) => p.isDefault) ?? null;

  /** Puts a saved plan in the list (replacing `replacedId`) and keeps one default. */
  function upsert(plan: CommissionPlanDto, replacedId?: string) {
    plans.setData((prev) => {
      const rest = (prev ?? [])
        .filter((p) => p.id !== plan.id && p.id !== replacedId)
        .map((p) => (plan.isDefault ? { ...p, isDefault: false } : p));
      return plan.isDefault ? [plan, ...rest] : [...rest, plan];
    });
  }

  async function makeDefault(plan: CommissionPlanDto) {
    try {
      upsert(await operatorApi.makeDefaultPlan(plan.id));
      setNotice(t('operator.plans.madeDefault', { name: plan.name }));
    } catch (err) {
      setNotice(null);
      throw err;
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('operator.plans.title')} description={t('operator.plans.description')} />

      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title={t('operator.plans.newPlan')} className="order-2 xl:order-1">
          <PlanForm onSaved={(plan) => upsert(plan)} />
        </Card>

        <section aria-labelledby="plans-title" className="order-1 flex flex-col gap-3 xl:order-2">
          <h2 id="plans-title" className="text-xl font-semibold">
            {t('operator.plans.yourPlans')}
          </h2>
          {plans.loading && !plans.data ? <LoadingBlock /> : null}
          {plans.error ? (
            <Alert
              tone="error"
              action={
                <Button variant="secondary" onClick={plans.reload}>
                  {t('common.retry')}
                </Button>
              }
            >
              {errorMessage(plans.error, tr)}
            </Alert>
          ) : null}
          {plans.data?.length === 0 ? (
            <p className="text-muted">{t('operator.plans.empty')}</p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {(plans.data ?? []).map((plan) => (
              <li key={plan.id}>
                <PlanCard
                  plan={plan}
                  onEdit={() => setEditing(plan)}
                  onMakeDefault={() => makeDefault(plan)}
                  onArchive={() => setArchiving(plan)}
                />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? t('operator.plans.editTitle', { name: editing.name }) : ''}
        description={t('operator.plans.editDescription')}
      >
        {editing ? (
          <PlanForm
            key={editing.id}
            plan={editing}
            onSaved={(plan) => {
              upsert(plan, editing.id);
              setNotice(t('operator.plans.updated', { name: plan.name }));
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={!!archiving}
        onClose={() => setArchiving(null)}
        title={archiving ? t('operator.plans.archiveTitle', { name: archiving.name }) : ''}
        description={
          archiving
            ? archiving.affiliateCount > 0
              ? defaultPlan
                ? tp('operator.plans.archiveMovesTo', archiving.affiliateCount, {
                    plan: defaultPlan.name,
                  })
                : tp('operator.plans.archiveMoves', archiving.affiliateCount)
              : t('operator.plans.archiveUnused')
            : undefined
        }
      >
        {archiving ? (
          <ArchiveConfirm
            plan={archiving}
            onCancel={() => setArchiving(null)}
            onArchived={(moved) => {
              plans.setData((prev) => (prev ?? []).filter((p) => p.id !== archiving.id));
              setNotice(
                moved > 0
                  ? tp('operator.plans.archivedMoved', moved, { name: archiving.name })
                  : t('operator.plans.archived', { name: archiving.name }),
              );
              setArchiving(null);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function ArchiveConfirm({
  plan,
  onCancel,
  onArchived,
}: {
  plan: CommissionPlanDto;
  onCancel: () => void;
  onArchived: (moved: number) => void;
}) {
  const tr = useT();
  const { t } = tr;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="danger"
          loading={busy}
          loadingText={t('operator.plans.archiving')}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const result = await operatorApi.archivePlan(plan.id);
              onArchived(result.affiliatesMoved);
            } catch (err) {
              setError(errorMessage(err, tr));
              setBusy(false);
            }
          }}
        >
          {t('operator.plans.archiveConfirm')}
        </Button>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  onEdit,
  onMakeDefault,
  onArchive,
}: {
  plan: CommissionPlanDto;
  onEdit: () => void;
  onMakeDefault: () => Promise<void>;
  onArchive: () => void;
}) {
  const tr = useT();
  const { t, tp, lang } = tr;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">{plan.name}</h3>
            <p className="text-sm text-muted">
              {plan.kind === 'fixed'
                ? t('operator.plans.kindFixed')
                : plan.mode === 'retroactive'
                  ? t('operator.plans.kindRetroactive')
                  : t('operator.plans.kindMarginal')}{' '}
              · {t(BASIS_LABEL[plan.basis])}
            </p>
          </div>
          {plan.isDefault ? (
            <StatusChip tone="brand">{t('operator.plans.default')}</StatusChip>
          ) : null}
        </div>
        {plan.kind === 'fixed' ? (
          <p className="text-2xl font-bold">{formatBps(plan.rateBps ?? 0, lang)}</p>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <caption className="visually-hidden">
              {t('operator.plans.tiersCaption', { name: plan.name })}
            </caption>
            <tbody>
              {tierRows(plan.tiers ?? [], tr).map((row) => (
                <tr key={row.label} className="border-b border-line last:border-0">
                  <th scope="row" className="py-1.5 font-normal">
                    {row.label}
                  </th>
                  <td className="py-1.5 text-right font-semibold tabular-nums">
                    {formatBps(row.rateBps, lang)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-sm text-muted">
          {plan.isDefault
            ? plan.affiliateCount > 0
              ? tp('operator.plans.appliesDefaultPlus', plan.affiliateCount)
              : t('operator.plans.appliesDefault')
            : plan.affiliateCount > 0
              ? tp('operator.plans.usedBy', plan.affiliateCount)
              : t('operator.plans.unused')}
        </p>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onEdit}>
            {t('common.edit')}
          </Button>
          {plan.isDefault ? null : (
            <>
              <Button
                variant="secondary"
                loading={busy}
                loadingText={t('common.saving')}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await onMakeDefault();
                  } catch (err) {
                    setError(errorMessage(err, tr));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('operator.plans.makeDefault')}
              </Button>
              <Button
                variant="ghost"
                className="text-danger-fg hover:bg-danger-soft"
                onClick={onArchive}
              >
                {t('operator.plans.archive')}
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Create a plan, or new rules for an existing one (saved as a new version of it). */
function PlanForm({
  plan,
  onSaved,
}: {
  plan?: CommissionPlanDto;
  onSaved: (plan: CommissionPlanDto) => void;
}) {
  const tr = useT();
  const { t } = tr;
  const editing = !!plan;
  const [name, setName] = useState(plan?.name ?? '');
  const [kind, setKind] = useState<Kind>(plan?.kind ?? 'tiered');
  const [rate, setRate] = useState(plan?.rateBps != null ? bpsToPercentInput(plan.rateBps) : '10');
  const [mode, setMode] = useState<Mode>(plan?.mode ?? 'marginal');
  const [rows, setRows] = useState<TierDraft[]>(() =>
    plan?.tiers?.length
      ? plan.tiers.map((t) => newTierRow(t.fromSale, bpsToPercentInput(t.rateBps)))
      : [newTierRow(1, '10'), newTierRow(6, '15'), newTierRow(11, '20')],
  );
  const [basis, setBasis] = useState<Basis>(plan?.basis ?? 'gross');
  const [isDefault, setIsDefault] = useState(plan?.isDefault ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function updateRow(key: string, patch: Partial<TierDraft>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    const last = rows[rows.length - 1];
    const lastFrom = last ? Number(last.fromSale) || 1 : 0;
    const lastPercent = last ? Number(last.percent.replace(',', '.')) || 0 : 5;
    setRows((prev) => [...prev, newTierRow(lastFrom + 5, String(Math.min(100, lastPercent + 5)))]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = t('operator.plans.nameRequired');
    let body: CreatePlanBody | null = null;
    if (kind === 'fixed') {
      const rateBps = percentToBps(rate);
      if (rateBps === null) next.rate = t('operator.plans.percentInvalid');
      else body = { kind: 'fixed', name: name.trim(), rateBps, basis, isDefault };
    } else {
      const result = validateTiers(rows, tr);
      Object.assign(next, result.errors);
      if (result.general) next.tiers = result.general;
      if (result.tiers)
        body = { kind: 'tiered', name: name.trim(), mode, tiers: result.tiers, basis, isDefault };
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || !body) return;

    setBusy(true);
    try {
      if (plan) {
        onSaved(await operatorApi.updatePlan(plan.id, body));
      } else {
        const created = await operatorApi.createPlan(body);
        onSaved(created);
        setSuccess(t('operator.plans.created', { name: created.name }));
        setName('');
        setIsDefault(false);
      }
    } catch (err) {
      setError(errorMessage(err, tr));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-5">
      <Field
        label={t('operator.plans.name')}
        name="name"
        autoComplete="off"
        required
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
      />

      <ChoiceGroup<Kind>
        legend={t('operator.plans.type')}
        name="kind"
        value={kind}
        onChange={setKind}
        gridClassName="grid gap-2 sm:grid-cols-2"
        options={[
          {
            value: 'fixed',
            label: t('operator.plans.fixed'),
            description: t('operator.plans.fixedDescription'),
          },
          {
            value: 'tiered',
            label: t('operator.plans.tiered'),
            description: t('operator.plans.tieredDescription'),
          },
        ]}
      />

      {kind === 'fixed' ? (
        <Field
          label={t('operator.plans.percent')}
          name="rate"
          inputMode="decimal"
          autoComplete="off"
          required
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          error={errors.rate}
          hint={t('operator.plans.percentHint')}
        />
      ) : (
        <>
          <fieldset className="min-w-0">
            <legend className="mb-1.5 font-semibold">{t('operator.plans.tiers')}</legend>
            <p className="mb-3 text-sm text-muted">{t('operator.plans.tiersHelp')}</p>
            <ol className="flex flex-col gap-3">
              {rows.map((row, index) => (
                <li key={row.key} className="rounded-2xl border border-line p-3">
                  <div className="flex items-end gap-2">
                    <label className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-sm font-semibold">{t('operator.plans.fromSale')}</span>
                      <input
                        className={INPUT_CLASSES}
                        inputMode="numeric"
                        autoComplete="off"
                        value={index === 0 ? '1' : row.fromSale}
                        readOnly={index === 0}
                        aria-invalid={!!errors[row.key] || undefined}
                        aria-describedby={errors[row.key] ? `${row.key}-error` : undefined}
                        onChange={(e) =>
                          updateRow(row.key, { fromSale: e.target.value.replace(/\D/g, '') })
                        }
                      />
                    </label>
                    <label className="flex w-28 flex-col gap-1">
                      <span className="text-sm font-semibold">
                        {t('operator.plans.percentColumn')}
                      </span>
                      <input
                        className={INPUT_CLASSES}
                        inputMode="decimal"
                        autoComplete="off"
                        value={row.percent}
                        aria-invalid={!!errors[row.key] || undefined}
                        aria-describedby={errors[row.key] ? `${row.key}-error` : undefined}
                        onChange={(e) => updateRow(row.key, { percent: e.target.value })}
                      />
                    </label>
                    <button
                      type="button"
                      className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-2 disabled:invisible"
                      onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                      disabled={index === 0}
                      aria-label={t('operator.plans.removeTier', { number: index + 1 })}
                    >
                      <IconX />
                    </button>
                  </div>
                  {errors[row.key] ? (
                    <p
                      id={`${row.key}-error`}
                      className="mt-1.5 text-sm font-medium text-danger-fg"
                    >
                      {errors[row.key]}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
            {errors.tiers ? (
              <p className="mt-2 text-sm font-medium text-danger-fg">{errors.tiers}</p>
            ) : null}
            <Button
              variant="ghost"
              icon={<IconPlus />}
              onClick={addRow}
              className="mt-2"
              disabled={rows.length >= 20}
            >
              {t('operator.plans.addTier')}
            </Button>
          </fieldset>

          <ChoiceGroup<Mode>
            legend={t('operator.plans.mode')}
            name="mode"
            value={mode}
            onChange={setMode}
            options={[
              {
                value: 'marginal',
                label: t('operator.plans.marginal'),
                description: planModeExplanation(tr, 'marginal'),
              },
              {
                value: 'retroactive',
                label: t('operator.plans.retroactive'),
                description: planModeExplanation(tr, 'retroactive'),
              },
            ]}
          />
        </>
      )}

      <ChoiceGroup<Basis>
        legend={t('operator.plans.basis')}
        name="basis"
        value={basis}
        onChange={setBasis}
        gridClassName="grid gap-2 sm:grid-cols-2"
        options={[
          {
            value: 'gross',
            label: t('operator.plans.basisGross'),
            description: t('operator.plans.basisGrossDescription'),
          },
          {
            value: 'net_of_tax',
            label: t('operator.plans.basisNet'),
            description: t('operator.plans.basisNetDescription'),
          },
        ]}
      />

      {plan?.isDefault ? null : (
        <label className="flex min-h-12 items-center gap-3">
          <input
            type="checkbox"
            className="size-6 shrink-0"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          <span>{t('operator.plans.isDefault')}</span>
        </label>
      )}

      {error ? <Alert tone="error">{error}</Alert> : null}
      {success ? <Alert tone="success">{success}</Alert> : null}
      <Button type="submit" size="lg" loading={busy} loadingText={t('common.saving')}>
        {editing ? t('operator.plans.saveRules') : t('operator.plans.create')}
      </Button>
    </form>
  );
}
