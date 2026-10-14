'use client';

import type {
  AffiliateWithStatsDto,
  CreateDiscountCodeBody,
  DiscountCodeDto,
  ProductDto,
} from '@ap/contracts';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { ChoiceGroup, Field, SelectField } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { IconPlus, IconTag } from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { isApiError } from '@/lib/api';
import { formatDate, todayKey } from '@/lib/dates';
import { codeState, discountText, normalizeCode } from '@/lib/discounts';
import { operatorApi } from '@/lib/endpoints';
import { bpsToPercentInput, minorToInput, parseMoneyInput, percentToBps } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { errorMessage, useApi } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,23}$/;

const STATE_CHIPS: Record<
  ReturnType<typeof codeState>,
  { key: MessageKey; tone: 'success' | 'warning' | 'neutral' | 'brand' }
> = {
  active: { key: 'operator.discounts.stateActive', tone: 'success' },
  paused: { key: 'operator.discounts.statePaused', tone: 'warning' },
  scheduled: { key: 'operator.discounts.stateScheduled', tone: 'brand' },
  expired: { key: 'operator.discounts.stateExpired', tone: 'neutral' },
  usedUp: { key: 'operator.discounts.stateUsedUp', tone: 'neutral' },
};

/**
 * Discount codes customers type when booking. A code given to an affiliate (a hotel's -10% for
 * its guests) makes the bookings with it theirs, with their commission.
 */
export function DiscountsScreen() {
  const i18n = useT();
  const { t } = i18n;
  const codes = useApi('operator-discount-codes', (signal) =>
    operatorApi.discountCodes({ signal }),
  );
  const products = useApi('operator-products', (signal) => operatorApi.products({ signal }));
  const affiliates = useApi('operator-affiliates', (signal) => operatorApi.affiliates({ signal }));
  const [editing, setEditing] = useState<DiscountCodeDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function saved(code: DiscountCodeDto) {
    codes.setData((prev) => {
      const list = prev ?? [];
      return list.some((c) => c.id === code.id)
        ? list.map((c) => (c.id === code.id ? code : c))
        : [code, ...list];
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('operator.discounts.title')}
        description={t('operator.discounts.description')}
      />

      <Card title={t('operator.discounts.newTitle')}>
        <CodeForm
          products={products.data ?? []}
          affiliates={affiliates.data ?? []}
          onSaved={(code) => {
            saved(code);
            setNotice(t('operator.discounts.created', { code: code.code }));
          }}
        />
      </Card>
      {notice ? (
        <Alert tone="success" title={notice}>
          {t('operator.discounts.createdHelp')}
        </Alert>
      ) : null}

      <Card title={t('operator.discounts.listTitle')}>
        {codes.loading && !codes.data ? (
          <LoadingBlock label={t('common.loading')} />
        ) : codes.error ? (
          <Alert
            tone="error"
            action={
              <Button variant="secondary" onClick={codes.reload}>
                {t('common.retry')}
              </Button>
            }
          >
            {errorMessage(codes.error, i18n)}
          </Alert>
        ) : (codes.data ?? []).length === 0 ? (
          <p className="text-muted">{t('operator.discounts.empty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {(codes.data ?? []).map((code) => (
              <CodeRow
                key={code.id}
                code={code}
                products={products.data ?? []}
                affiliates={affiliates.data ?? []}
                onEdit={() => setEditing(code)}
                onSaved={saved}
              />
            ))}
          </ul>
        )}
      </Card>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t('operator.discounts.editTitle', { code: editing?.code ?? '' })}
      >
        {editing ? (
          <CodeForm
            key={editing.id}
            code={editing}
            products={products.data ?? []}
            affiliates={affiliates.data ?? []}
            onSaved={(code) => {
              saved(code);
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function CodeRow({
  code,
  products,
  affiliates,
  onEdit,
  onSaved,
}: {
  code: DiscountCodeDto;
  products: ProductDto[];
  affiliates: AffiliateWithStatsDto[];
  onEdit: () => void;
  onSaved: (code: DiscountCodeDto) => void;
}) {
  const i18n = useT();
  const { t, lang } = i18n;
  const { tenant } = useOperator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = codeState(code, todayKey(tenant.timezone));
  const chip = STATE_CHIPS[state];
  const day = (key: string) => formatDate(`${key}T12:00:00Z`, 'UTC', lang);
  const tripNames = code.productIds
    .map((id) => products.find((p) => p.id === id)?.name)
    .filter(Boolean)
    .join(', ');
  const affiliate = affiliates.find((a) => a.id === code.affiliateId);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      onSaved(await operatorApi.updateDiscountCode(code.id, { active: !code.active }));
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-soft-fg">
            <IconTag />
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="break-all font-mono text-lg font-bold">{code.code}</span>
              <span className="font-semibold">{discountText(code, tenant.currency, lang)}</span>
              <StatusChip tone={chip.tone}>{t(chip.key)}</StatusChip>
            </p>
            <p className="text-sm text-muted">
              {code.affiliateName
                ? t('operator.discounts.forAffiliate', { name: code.affiliateName })
                : t('operator.discounts.forEveryone')}
              {affiliate && affiliate.status !== 'active'
                ? ` · ${t('operator.discounts.affiliateInactive')}`
                : ''}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onEdit}>
            {t('operator.discounts.edit')}
          </Button>
          <Button variant="ghost" loading={busy} onClick={() => void toggle()}>
            {code.active ? t('operator.discounts.pause') : t('operator.discounts.resume')}
          </Button>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted">{t('operator.discounts.trips')}</dt>
          <dd>{tripNames || t('operator.discounts.allTrips')}</dd>
        </div>
        <div>
          <dt className="text-muted">{t('operator.discounts.valid')}</dt>
          <dd>
            {code.validFrom && code.validUntil
              ? t('operator.discounts.validRange', {
                  from: day(code.validFrom),
                  until: day(code.validUntil),
                })
              : code.validFrom
                ? t('operator.discounts.validFromOnly', { from: day(code.validFrom) })
                : code.validUntil
                  ? t('operator.discounts.validUntilOnly', { until: day(code.validUntil) })
                  : t('operator.discounts.validAlways')}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t('operator.discounts.uses')}</dt>
          <dd>
            {code.maxUses !== null
              ? t('operator.discounts.usesOf', { uses: code.uses, max: code.maxUses })
              : code.uses}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t('operator.discounts.revenue')}</dt>
          <dd>
            <MoneyText amountMinor={code.revenueMinor} currency={tenant.currency} lang={lang} />
          </dd>
        </div>
      </dl>
      {error ? <Alert tone="error">{error}</Alert> : null}
    </li>
  );
}

type Kind = 'percent' | 'amount';

function CodeForm({
  code,
  products,
  affiliates,
  onSaved,
}: {
  /** The code to change; empty for a new one. */
  code?: DiscountCodeDto;
  products: ProductDto[];
  affiliates: AffiliateWithStatsDto[];
  onSaved: (code: DiscountCodeDto) => void;
}) {
  const i18n = useT();
  const { t } = i18n;
  const { tenant } = useOperator();
  const [text, setText] = useState(code?.code ?? '');
  const [kind, setKind] = useState<Kind>(code?.amountMinor != null ? 'amount' : 'percent');
  const [value, setValue] = useState(
    code?.percentBps != null
      ? bpsToPercentInput(code.percentBps)
      : code?.amountMinor != null
        ? minorToInput(code.amountMinor, tenant.currency)
        : '',
  );
  const [affiliateId, setAffiliateId] = useState(code?.affiliateId ?? '');
  const [productIds, setProductIds] = useState<string[]>(code?.productIds ?? []);
  const [validFrom, setValidFrom] = useState(code?.validFrom ?? '');
  const [validUntil, setValidUntil] = useState(code?.validUntil ?? '');
  const [maxUses, setMaxUses] = useState(code?.maxUses != null ? String(code.maxUses) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Active affiliates, and the code's own one even if it is no longer active.
  const choices = affiliates.filter((a) => a.status === 'active' || a.id === code?.affiliateId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    const clean = normalizeCode(text);
    if (!CODE_RE.test(clean)) next.code = t('operator.discounts.errCode');
    let percentBps: number | null = null;
    let amountMinor: number | null = null;
    if (kind === 'percent') {
      percentBps = percentToBps(value);
      if (percentBps === null || percentBps < 1 || percentBps > 9000)
        next.value = t('operator.discounts.errPercent');
    } else {
      amountMinor = parseMoneyInput(value, tenant.currency);
      if (amountMinor === null || amountMinor < 1) next.value = t('operator.discounts.errAmount');
    }
    const uses = maxUses.trim() ? Number(maxUses) : null;
    if (uses !== null && (!Number.isInteger(uses) || uses < 1))
      next.maxUses = t('operator.discounts.errMaxUses');
    if (validFrom && validUntil && validFrom > validUntil)
      next.validUntil = t('operator.discounts.errDates');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const body: CreateDiscountCodeBody = {
      code: clean,
      percentBps,
      amountMinor,
      affiliateId: affiliateId || null,
      productIds,
      validFrom: validFrom || null,
      validUntil: validUntil || null,
      maxUses: uses,
    };
    setBusy(true);
    setError(null);
    try {
      const saved = code
        ? await operatorApi.updateDiscountCode(code.id, body)
        : await operatorApi.createDiscountCode(body);
      onSaved(saved);
      if (!code) {
        setText('');
        setValue('');
        setAffiliateId('');
        setProductIds([]);
        setValidFrom('');
        setValidUntil('');
        setMaxUses('');
      }
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        setErrors({ code: t('operator.discounts.errTaken', { code: clean }) });
      } else {
        setError(errorMessage(err, i18n));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-4">
      <Field
        label={t('operator.discounts.code')}
        hint={t('operator.discounts.codeHint')}
        name="code"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        required
        maxLength={24}
        className="[&_input]:font-mono [&_input]:uppercase"
        value={text}
        onChange={(e) => setText(e.target.value)}
        error={errors.code}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <ChoiceGroup<Kind>
          legend={t('operator.discounts.kind')}
          name="kind"
          value={kind}
          onChange={(next) => {
            setKind(next);
            setValue('');
          }}
          gridClassName="grid grid-cols-2 gap-2"
          options={[
            { value: 'percent', label: t('operator.discounts.kindPercent') },
            {
              value: 'amount',
              label: t('operator.discounts.kindAmount', { currency: tenant.currency }),
            },
          ]}
        />
        <Field
          label={
            kind === 'percent'
              ? t('operator.discounts.percent')
              : t('operator.discounts.amount', { currency: tenant.currency })
          }
          hint={
            kind === 'percent'
              ? t('operator.discounts.percentHint')
              : t('operator.discounts.amountHint')
          }
          name="value"
          inputMode="decimal"
          autoComplete="off"
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={errors.value}
        />
      </div>
      <SelectField
        label={t('operator.discounts.affiliate')}
        hint={t('operator.discounts.affiliateHint')}
        name="affiliate"
        value={affiliateId}
        onChange={(e) => setAffiliateId(e.target.value)}
      >
        <option value="">{t('operator.discounts.noAffiliate')}</option>
        {choices.map((a) => (
          <option key={a.id} value={a.id}>
            {a.displayName}
          </option>
        ))}
      </SelectField>
      {products.length > 1 ? (
        <fieldset className="min-w-0">
          <legend className="mb-1 font-semibold">{t('operator.discounts.trips')}</legend>
          <p className="mb-2 text-sm text-muted">{t('operator.discounts.tripsHint')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {products.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-3 rounded-xl border border-line p-3"
              >
                <input
                  type="checkbox"
                  className="size-6 shrink-0"
                  checked={productIds.includes(p.id)}
                  onChange={(e) =>
                    setProductIds((prev) =>
                      e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id),
                    )
                  }
                />
                <span className="min-w-0">{p.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('operator.discounts.validFrom')}
          optionalText={t('catalog.productForm.optional')}
          name="validFrom"
          type="date"
          value={validFrom}
          onChange={(e) => setValidFrom(e.target.value)}
        />
        <Field
          label={t('operator.discounts.validUntil')}
          optionalText={t('catalog.productForm.optional')}
          name="validUntil"
          type="date"
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
          error={errors.validUntil}
        />
      </div>
      <p className="-mt-2 text-sm text-muted">{t('operator.discounts.validHint')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('operator.discounts.maxUses')}
          optionalText={t('catalog.productForm.optional')}
          hint={t('operator.discounts.maxUsesHint')}
          name="maxUses"
          inputMode="numeric"
          autoComplete="off"
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ''))}
          error={errors.maxUses}
        />
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        type="submit"
        size="lg"
        icon={code ? undefined : <IconPlus />}
        loading={busy}
        block
        className="sm:w-auto sm:self-start"
      >
        {code ? t('operator.discounts.save') : t('operator.discounts.create')}
      </Button>
    </form>
  );
}
