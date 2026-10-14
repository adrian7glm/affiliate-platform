'use client';

import type { OperatorSettingsDto, UpdateSettingsBody } from '@ap/contracts';
import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field, TextareaField } from '@/components/Field';
import { IconCheck, IconExternal, IconImage, IconTicket } from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { BrandScope } from '@/components/public/PublicFrame';
import { LoadingBlock } from '@/components/Spinner';
import { StickyActions } from '@/components/StickyActions';
import { brandPalette, contrastRatio, safeLogoUrl } from '@/lib/brandColors';
import { isValidEmail, isValidPhone, normalizeEmail, normalizePhone } from '@/lib/contact';
import { operatorApi } from '@/lib/endpoints';
import { formatMoney } from '@/lib/format';
import { formatDuration } from '@/lib/i18n';
import { errorMessage, useApi } from '@/lib/useApi';
import { useT } from '@/components/I18nProvider';
import { useOperator } from '../OperatorContext';
import { LogoError, logoDataUrl } from './logo';

/** Colors that work well for tourism brands; any other color can be picked too. */
/** `name` is the key of the color's name in catalog.settings.colors. */
const PRESETS = [
  { hex: '#0369a1', name: 'sea' },
  { hex: '#0f766e', name: 'turquoise' },
  { hex: '#15803d', name: 'delta' },
  { hex: '#b45309', name: 'amber' },
  { hex: '#c2410c', name: 'sunset' },
  { hex: '#be123c', name: 'coral' },
  { hex: '#7c3aed', name: 'violet' },
  { hex: '#1e293b', name: 'navy' },
] as const;
const PLATFORM_COLOR = '#0369a1';

interface Draft {
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  allowPayOnSite: boolean;
  attributionWindowDays: string;
  cancellationPolicy: string;
  contactEmail: string;
  contactPhone: string;
  reviewUrl: string;
  remindCustomers: boolean;
  askForReviews: boolean;
  notifyAffiliates: boolean;
  monthlyReport: boolean;
}

/** The automatic messages an operator can switch off, in the order they are shown. */
const MESSAGE_TOGGLES = [
  'remindCustomers',
  'askForReviews',
  'notifyAffiliates',
  'monthlyReport',
] as const;

/** Same rule as the API: a full https link to a review page. */
const REVIEW_URL = /^https:\/\/[^\s"'<>]+\.[^\s"'<>]+$/;

function draftOf(settings: OperatorSettingsDto): Draft {
  return {
    name: settings.name,
    logoUrl: settings.branding.logoUrl ?? null,
    primaryColor: settings.branding.primaryColor ?? null,
    allowPayOnSite: settings.allowPayOnSite,
    attributionWindowDays: String(settings.attributionWindowDays),
    cancellationPolicy: settings.cancellationPolicy ?? '',
    contactEmail: settings.contactEmail ?? '',
    contactPhone: settings.contactPhone ?? '',
    reviewUrl: settings.reviewUrl ?? '',
    remindCustomers: settings.remindCustomers,
    askForReviews: settings.askForReviews,
    notifyAffiliates: settings.notifyAffiliates,
    monthlyReport: settings.monthlyReport,
  };
}

/** Only the fields that changed, so a save never overwrites what it did not touch. */
function changes(saved: Draft, draft: Draft): UpdateSettingsBody {
  const body: UpdateSettingsBody = {};
  if (draft.name.trim() !== saved.name) body.name = draft.name.trim();
  if (draft.logoUrl !== saved.logoUrl) body.logoUrl = draft.logoUrl;
  if (draft.primaryColor !== saved.primaryColor) body.primaryColor = draft.primaryColor;
  if (draft.allowPayOnSite !== saved.allowPayOnSite) body.allowPayOnSite = draft.allowPayOnSite;
  if (draft.attributionWindowDays !== saved.attributionWindowDays) {
    body.attributionWindowDays = Number(draft.attributionWindowDays);
  }
  // An empty field goes back to the platform's text (policy) or hides the contact.
  const policy = draft.cancellationPolicy.trim();
  if (policy !== saved.cancellationPolicy) body.cancellationPolicy = policy || null;
  const email = draft.contactEmail.trim() ? normalizeEmail(draft.contactEmail) : '';
  if (email !== saved.contactEmail) body.contactEmail = email || null;
  const phone = draft.contactPhone.trim() ? normalizePhone(draft.contactPhone) : '';
  if (phone !== saved.contactPhone) body.contactPhone = phone || null;
  const reviewUrl = draft.reviewUrl.trim();
  if (reviewUrl !== saved.reviewUrl) body.reviewUrl = reviewUrl || null;
  for (const key of MESSAGE_TOGGLES) {
    if (draft[key] !== saved[key]) body[key] = draft[key];
  }
  return body;
}

export function SettingsScreen() {
  const settings = useApi('operator-settings', (signal) => operatorApi.settings({ signal }));
  const i18n = useT();
  const { t } = i18n;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('catalog.settings.title')}
        description={t('catalog.settings.description')}
      />
      {settings.loading && !settings.data ? <LoadingBlock /> : null}
      {settings.error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={settings.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(settings.error, i18n)}
        </Alert>
      ) : null}
      {settings.data ? (
        <SettingsForm
          key={settings.data.slug}
          settings={settings.data}
          onSaved={(next) => settings.setData(next)}
        />
      ) : null}
    </div>
  );
}

function SettingsForm({
  settings,
  onSaved,
}: {
  settings: OperatorSettingsDto;
  onSaved: (settings: OperatorSettingsDto) => void;
}) {
  const { dashboard } = useOperator();
  const i18n = useT();
  const { t, tk } = i18n;
  const [saved, setSaved] = useState(() => draftOf(settings));
  const [draft, setDraft] = useState(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const readOnly = !settings.canEdit;
  const dirty = Object.keys(changes(saved, draft)).length > 0;

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function update(patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setSuccess(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!draft.name.trim()) next.name = t('catalog.settings.errName');
    const days = Number(draft.attributionWindowDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      next.attributionWindowDays = t('catalog.settings.errDays');
    }
    const email = draft.contactEmail.trim();
    if (email && !isValidEmail(normalizeEmail(email))) {
      next.contactEmail = t('catalog.settings.errContactEmail');
    }
    const phone = draft.contactPhone.trim();
    if (phone && !isValidPhone(normalizePhone(phone))) {
      next.contactPhone = t('catalog.settings.errContactPhone');
    }
    const reviewUrl = draft.reviewUrl.trim();
    if (reviewUrl && !REVIEW_URL.test(reviewUrl)) {
      next.reviewUrl = t('catalog.settings.errReviewUrl');
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      const result = await operatorApi.updateSettings(changes(saved, draft));
      const fresh = draftOf(result);
      setSaved(fresh);
      setDraft(fresh);
      onSaved(result);
      setSuccess(t('catalog.settings.saved'));
      if (result.name !== settings.name) dashboard.reload();
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {readOnly ? <Alert tone="info">{t('catalog.settings.ownerOnly')}</Alert> : null}
      <fieldset disabled={readOnly} className="contents">
        {/* Phones: the preview sits right under the color picker. Wide screens: beside the form. */}
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card title={t('catalog.settings.nameAndLogo')}>
            <div className="flex flex-col gap-5">
              <Field
                label={t('catalog.settings.businessName')}
                hint={t('catalog.settings.businessNameHint')}
                name="name"
                autoComplete="organization"
                maxLength={120}
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
                error={errors.name}
              />
              <LogoPicker
                value={draft.logoUrl}
                name={draft.name}
                onChange={(logoUrl) => update({ logoUrl })}
              />
            </div>
          </Card>

          <Card
            title={t('catalog.settings.colorTitle')}
            description={t('catalog.settings.colorDescription')}
          >
            <ColorPicker
              value={draft.primaryColor}
              onChange={(primaryColor) => update({ primaryColor })}
            />
          </Card>

          <section
            aria-labelledby="preview-title"
            className="flex flex-col gap-3 xl:sticky xl:top-4 xl:col-start-2 xl:row-span-3 xl:row-start-1"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="preview-title" className="text-xl font-semibold">
                {t('catalog.settings.previewTitle')}
              </h2>
              <a
                href={`/b/${encodeURIComponent(settings.slug)}`}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-12 items-center gap-2 rounded-xl px-2 font-semibold text-brand hover:bg-brand-soft"
              >
                <IconExternal size={20} />
                {t('catalog.settings.openPage')}
              </a>
            </div>
            <Preview draft={draft} currency={settings.currency} />
          </section>

          <Card title={t('catalog.settings.bookingAndPayment')}>
            <div className="flex flex-col gap-5">
              <label className="flex items-start gap-3 rounded-2xl border border-line p-3">
                <input
                  type="checkbox"
                  className="mt-0.5 size-6 shrink-0"
                  checked={draft.allowPayOnSite}
                  onChange={(e) => update({ allowPayOnSite: e.target.checked })}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">{t('catalog.settings.payOnSite')}</span>
                  <span className="text-sm text-muted">{t('catalog.settings.payOnSiteHelp')}</span>
                </span>
              </label>
              <Field
                label={t('catalog.settings.attribution')}
                hint={t('catalog.settings.attributionHint')}
                name="attributionWindowDays"
                inputMode="numeric"
                autoComplete="off"
                value={draft.attributionWindowDays}
                onChange={(e) =>
                  update({ attributionWindowDays: e.target.value.replace(/\D/g, '') })
                }
                error={errors.attributionWindowDays}
              />
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted">{t('catalog.settings.currency')}</dt>
                  <dd className="font-semibold">{settings.currency}</dd>
                </div>
                <div>
                  <dt className="text-muted">{t('catalog.settings.timezone')}</dt>
                  <dd className="font-semibold">{settings.timezone}</dd>
                </div>
              </dl>
            </div>
          </Card>

          <Card
            title={t('catalog.settings.customersTitle')}
            description={t('catalog.settings.customersDescription')}
          >
            <div className="flex flex-col gap-5">
              <Field
                label={t('catalog.settings.contactPhone')}
                hint={t('catalog.settings.contactPhoneHint')}
                name="contactPhone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={draft.contactPhone}
                onChange={(e) => update({ contactPhone: e.target.value })}
                error={errors.contactPhone}
              />
              <Field
                label={t('catalog.settings.contactEmail')}
                name="contactEmail"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={draft.contactEmail}
                onChange={(e) => update({ contactEmail: e.target.value })}
                error={errors.contactEmail}
              />
              <TextareaField
                label={t('catalog.settings.cancellationPolicy')}
                hint={t('catalog.settings.cancellationPolicyHint')}
                name="cancellationPolicy"
                rows={5}
                maxLength={2000}
                placeholder={t('public.policy.default', {
                  tenant: draft.name.trim() || settings.name,
                })}
                value={draft.cancellationPolicy}
                onChange={(e) => update({ cancellationPolicy: e.target.value })}
              />
            </div>
          </Card>

          <Card
            title={t('catalog.settings.messagesTitle')}
            description={t('catalog.settings.messagesDescription')}
          >
            <div className="flex flex-col gap-3">
              {MESSAGE_TOGGLES.map((key) => (
                <label
                  key={key}
                  className="flex items-start gap-3 rounded-2xl border border-line p-3"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-6 shrink-0"
                    checked={draft[key]}
                    onChange={(e) => update({ [key]: e.target.checked })}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-semibold">{tk(`catalog.settings.messages.${key}`)}</span>
                    <span className="text-sm text-muted">
                      {tk(`catalog.settings.messages.${key}Help`)}
                    </span>
                  </span>
                </label>
              ))}
              <Field
                label={t('catalog.settings.reviewUrl')}
                hint={t('catalog.settings.reviewUrlHint')}
                name="reviewUrl"
                type="url"
                inputMode="url"
                autoComplete="url"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="https://g.page/r/..."
                value={draft.reviewUrl}
                onChange={(e) => update({ reviewUrl: e.target.value })}
                error={errors.reviewUrl}
              />
              {draft.askForReviews && !draft.reviewUrl.trim() ? (
                <p className="text-sm text-muted">{t('catalog.settings.reviewUrlMissing')}</p>
              ) : null}
            </div>
          </Card>
        </div>
      </fieldset>

      {readOnly || !(dirty || busy || error || success) ? null : (
        <StickyActions>
          <div className="flex flex-col gap-2">
            {error ? <Alert tone="error">{error}</Alert> : null}
            {success ? <Alert tone="success">{success}</Alert> : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                size="lg"
                loading={busy}
                loadingText={t('catalog.settings.saving')}
                disabled={!dirty}
                className="flex-1 sm:flex-none"
              >
                {t('catalog.settings.save')}
              </Button>
              {dirty ? (
                <Button variant="ghost" onClick={() => setDraft(saved)} disabled={busy}>
                  {t('catalog.settings.discard')}
                </Button>
              ) : (
                <p className="text-sm text-muted">{t('catalog.settings.noChanges')}</p>
              )}
            </div>
          </div>
        </StickyActions>
      )}
    </form>
  );
}

function LogoPicker({
  value,
  name,
  onChange,
}: {
  value: string | null;
  name: string;
  onChange: (value: string | null) => void;
}) {
  const { t } = useT();
  const inputId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logo = safeLogoUrl(value);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await logoDataUrl(file, t));
    } catch (err) {
      setError(err instanceof LogoError ? err.message : t('catalog.settings.logoErrUpload'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="font-semibold" id={`${inputId}-label`}>
        {t('catalog.settings.logo')}
      </p>
      <p className="text-sm text-muted">{t('catalog.settings.logoHelp')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-20 w-48 items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface-2 p-2">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt={t('catalog.settings.logoAlt', { name })}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="flex items-center gap-2 text-sm text-muted">
              <IconImage size={20} />
              {t('catalog.settings.noLogo')}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <label
            htmlFor={inputId}
            className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-line-strong bg-surface px-4 font-semibold hover:bg-surface-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
          >
            {busy
              ? t('catalog.settings.logoPreparing')
              : logo
                ? t('catalog.settings.changeLogo')
                : t('catalog.settings.chooseLogo')}
            <input
              id={inputId}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="visually-hidden"
              aria-describedby={error ? `${inputId}-error` : undefined}
              onChange={(e) => void pick(e)}
              disabled={busy}
            />
          </label>
          {logo ? (
            <Button variant="ghost" onClick={() => onChange(null)}>
              {t('catalog.settings.removeLogo')}
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="text-sm font-medium text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const { t, tk } = useT();
  const customId = useId();
  const isPreset = value === null || PRESETS.some((p) => p.hex === value);
  const current = value ?? PLATFORM_COLOR;
  const light = brandPalette(current)?.light;
  // How the exact color reads as text on white; below 3:1 we tell them links use a darker shade.
  const lowContrast = contrastRatio(current, '#ffffff') < 3;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="min-w-0">
        <legend className="visually-hidden">{t('catalog.settings.chooseColor')}</legend>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          <SwatchOption
            name="brand-color"
            label={t('catalog.settings.platformColor')}
            hex={PLATFORM_COLOR}
            checked={value === null}
            onSelect={() => onChange(null)}
            caption={t('catalog.settings.defaultColor')}
          />
          {PRESETS.filter((p) => p.hex !== PLATFORM_COLOR).map((preset) => (
            <SwatchOption
              key={preset.hex}
              name="brand-color"
              label={tk(`catalog.settings.colors.${preset.name}`)}
              hex={preset.hex}
              checked={value === preset.hex}
              onSelect={() => onChange(preset.hex)}
            />
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={customId} className="font-semibold">
          {t('catalog.settings.otherColor')}
        </label>
        <input
          id={customId}
          type="color"
          value={current}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className={`h-12 w-16 cursor-pointer rounded-xl border-2 bg-surface p-1 ${
            isPreset ? 'border-line-strong' : 'border-fg'
          }`}
        />
        <span className="font-mono text-sm tabular-nums text-muted">{current}</span>
      </div>
      {lowContrast && light ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <span
            aria-hidden="true"
            className="inline-block size-4 rounded-full"
            style={{ background: light['--brand-strong'] }}
          />
          {t('catalog.settings.lightColorNote')}
        </p>
      ) : null}
    </div>
  );
}

function SwatchOption({
  name,
  label,
  hex,
  checked,
  onSelect,
  caption,
}: {
  name: string;
  label: string;
  hex: string;
  checked: boolean;
  onSelect: () => void;
  caption?: string;
}) {
  const on = brandPalette(hex)?.light['--on-brand'] ?? '#ffffff';
  return (
    <label className="flex cursor-pointer flex-col items-center gap-1 text-center">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="peer visually-hidden"
      />
      <span
        className="flex size-12 items-center justify-center rounded-full ring-offset-2 ring-offset-surface peer-checked:ring-4 peer-checked:ring-fg peer-focus-visible:ring-4 peer-focus-visible:ring-focus"
        style={{ background: hex, color: on }}
      >
        {checked ? <IconCheck size={22} /> : null}
      </span>
      <span className="text-xs leading-tight text-muted">{caption ?? label}</span>
      {caption ? <span className="visually-hidden">{label}</span> : null}
    </label>
  );
}

/** A small, live mock of the booking page and the ticket with the current draft. */
function Preview({ draft, currency }: { draft: Draft; currency: string }) {
  const { t, lang } = useT();
  const logo = safeLogoUrl(draft.logoUrl);
  const name = draft.name.trim() || t('catalog.settings.previewName');
  return (
    <BrandScope
      color={draft.primaryColor}
      className="overflow-hidden rounded-3xl border border-line bg-bg"
    >
      <div aria-hidden="true" className="pointer-events-none select-none">
        <div className="flex min-h-14 items-center justify-between border-b border-line bg-surface px-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt=""
              className="h-9 w-auto max-w-[10rem] rounded-lg object-contain dark:bg-white dark:px-2 dark:py-1"
            />
          ) : (
            <span className="truncate font-bold">{name}</span>
          )}
          <span className="rounded-lg bg-brand-soft px-2 py-1 text-xs font-semibold uppercase text-brand-soft-fg">
            {lang}
          </span>
        </div>
        <div className="flex flex-col gap-4 p-4">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-lg font-semibold">{t('catalog.settings.sampleTrip')}</p>
            <p className="text-sm text-muted">
              {t('catalog.settings.sampleMeta', { duration: formatDuration(90, lang) })}
            </p>
            <p className="mt-2">
              {t('catalog.settings.sampleFromBefore')}{' '}
              <strong>{formatMoney(12000, currency, lang)}</strong>
            </p>
            <p className="mt-1 text-sm font-semibold text-brand-strong underline">
              {t('catalog.settings.sampleDetails')}
            </p>
            <span className="mt-3 flex min-h-12 items-center justify-center rounded-2xl bg-brand font-semibold text-on-brand">
              {t('catalog.settings.sampleBook')}
            </span>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
            <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-soft-fg">
              <IconTicket size={28} />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-muted">{t('catalog.settings.sampleTicket', { name })}</p>
              <p className="font-semibold">{t('catalog.settings.sampleSlot')}</p>
              <span className="mt-1 inline-flex rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-soft-fg">
                {t('catalog.settings.sampleValid')}
              </span>
            </div>
          </div>
        </div>
      </div>
      <p className="visually-hidden">{t('catalog.settings.previewSr')}</p>
    </BrandScope>
  );
}
