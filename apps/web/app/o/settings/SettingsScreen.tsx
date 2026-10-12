'use client';

import type { OperatorSettingsDto, UpdateSettingsBody } from '@ap/contracts';
import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { IconCheck, IconExternal, IconImage, IconTicket } from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { BrandScope } from '@/components/public/PublicShell';
import { LoadingBlock } from '@/components/Spinner';
import { StickyActions } from '@/components/StickyActions';
import { brandPalette, contrastRatio, safeLogoUrl } from '@/lib/brandColors';
import { operatorApi } from '@/lib/endpoints';
import { formatMoney } from '@/lib/format';
import { errorMessageRo, useApi } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';
import { LogoError, logoDataUrl } from './logo';

/** Colors that work well for tourism brands; any other color can be picked too. */
const PRESETS = [
  { hex: '#0369a1', name: 'Albastru mare' },
  { hex: '#0f766e', name: 'Turcoaz' },
  { hex: '#15803d', name: 'Verde delta' },
  { hex: '#b45309', name: 'Chihlimbar' },
  { hex: '#c2410c', name: 'Apus' },
  { hex: '#be123c', name: 'Corai' },
  { hex: '#7c3aed', name: 'Violet' },
  { hex: '#1e293b', name: 'Bleumarin' },
];
const PLATFORM_COLOR = '#0369a1';

interface Draft {
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  allowPayOnSite: boolean;
  attributionWindowDays: string;
}

function draftOf(settings: OperatorSettingsDto): Draft {
  return {
    name: settings.name,
    logoUrl: settings.branding.logoUrl ?? null,
    primaryColor: settings.branding.primaryColor ?? null,
    allowPayOnSite: settings.allowPayOnSite,
    attributionWindowDays: String(settings.attributionWindowDays),
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
  return body;
}

export function SettingsScreen() {
  const settings = useApi('operator-settings', (signal) => operatorApi.settings({ signal }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Setări și aspect"
        description="Cum arată pagina de rezervări și biletele clienților tăi, și cum se poate plăti."
      />
      {settings.loading && !settings.data ? <LoadingBlock /> : null}
      {settings.error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={settings.reload}>
              Încearcă din nou
            </Button>
          }
        >
          {errorMessageRo(settings.error)}
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
    if (!draft.name.trim()) next.name = 'Scrie numele afacerii, așa cum îl văd clienții.';
    const days = Number(draft.attributionWindowDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      next.attributionWindowDays = 'Între 1 și 365 de zile.';
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
      setSuccess('Setările au fost salvate. Clienții văd noul aspect imediat.');
      if (result.name !== settings.name) dashboard.reload();
    } catch (err) {
      setError(errorMessageRo(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {readOnly ? (
        <Alert tone="info">Doar proprietarul contului poate schimba setările.</Alert>
      ) : null}
      <fieldset disabled={readOnly} className="contents">
        {/* Phones: the preview sits right under the color picker. Wide screens: beside the form. */}
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card title="Numele și logoul">
            <div className="flex flex-col gap-5">
              <Field
                label="Numele afacerii"
                hint="Apare pe pagina de rezervări, pe bilete și în mesajele către clienți."
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
            title="Culoarea ta"
            description="Pentru butoane și linkuri pe pagina de rezervări și pe bilete. Textul își ajustează automat nuanța ca să rămână ușor de citit."
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
                Așa văd clienții
              </h2>
              <a
                href={`/b/${encodeURIComponent(settings.slug)}`}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-12 items-center gap-2 rounded-xl px-2 font-semibold text-brand hover:bg-brand-soft"
              >
                <IconExternal size={20} />
                Deschide pagina
              </a>
            </div>
            <Preview draft={draft} currency={settings.currency} />
          </section>

          <Card title="Rezervări și plată">
            <div className="flex flex-col gap-5">
              <label className="flex items-start gap-3 rounded-2xl border border-line p-3">
                <input
                  type="checkbox"
                  className="mt-0.5 size-6 shrink-0"
                  checked={draft.allowPayOnSite}
                  onChange={(e) => update({ allowPayOnSite: e.target.checked })}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">Plata la îmbarcare</span>
                  <span className="text-sm text-muted">
                    Afiliații pot face rezervări pe care clientul le plătește la tine, când urcă la
                    bord. Suma de încasat apare când scanezi biletul. Fără această opțiune, toate
                    rezervările se plătesc online.
                  </span>
                </span>
              </label>
              <Field
                label="Cât timp contează un link (zile)"
                hint="Dacă un client deschide linkul unui afiliat și rezervă în acest interval, rezervarea e a afiliatului. Uzual: 30 de zile."
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
                  <dt className="text-muted">Monedă</dt>
                  <dd className="font-semibold">{settings.currency}</dd>
                </div>
                <div>
                  <dt className="text-muted">Fus orar</dt>
                  <dd className="font-semibold">{settings.timezone}</dd>
                </div>
              </dl>
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
                loadingText="Se salvează…"
                disabled={!dirty}
                className="flex-1 sm:flex-none"
              >
                Salvează
              </Button>
              {dirty ? (
                <Button variant="ghost" onClick={() => setDraft(saved)} disabled={busy}>
                  Renunță
                </Button>
              ) : (
                <p className="text-sm text-muted">Nicio modificare nesalvată.</p>
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
      onChange(await logoDataUrl(file));
    } catch (err) {
      setError(err instanceof LogoError ? err.message : 'Nu am putut încărca imaginea.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="font-semibold" id={`${inputId}-label`}>
        Logo
      </p>
      <p className="text-sm text-muted">
        Cel mai bine arată un logo lat, pe fundal transparent (PNG sau SVG). Îl micșorăm automat.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-20 w-48 items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface-2 p-2">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={`Logo ${name}`} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="flex items-center gap-2 text-sm text-muted">
              <IconImage size={20} />
              Fără logo
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <label
            htmlFor={inputId}
            className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-line-strong bg-surface px-4 font-semibold hover:bg-surface-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
          >
            {busy ? 'Se pregătește…' : logo ? 'Schimbă logoul' : 'Alege logoul'}
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
              Scoate logoul
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
  const customId = useId();
  const isPreset = value === null || PRESETS.some((p) => p.hex === value);
  const current = value ?? PLATFORM_COLOR;
  const light = brandPalette(current)?.light;
  // How the exact color reads as text on white; below 3:1 we tell them links use a darker shade.
  const lowContrast = contrastRatio(current, '#ffffff') < 3;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="min-w-0">
        <legend className="visually-hidden">Alege o culoare</legend>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          <SwatchOption
            name="brand-color"
            label="Culoarea platformei"
            hex={PLATFORM_COLOR}
            checked={value === null}
            onSelect={() => onChange(null)}
            caption="Implicit"
          />
          {PRESETS.filter((p) => p.hex !== PLATFORM_COLOR).map((preset) => (
            <SwatchOption
              key={preset.hex}
              name="brand-color"
              label={preset.name}
              hex={preset.hex}
              checked={value === preset.hex}
              onSelect={() => onChange(preset.hex)}
            />
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={customId} className="font-semibold">
          Altă culoare
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
          Culoare deschisă: butoanele o păstrează, iar linkurile folosesc o nuanță mai închisă.
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
  const logo = safeLogoUrl(draft.logoUrl);
  const name = draft.name.trim() || 'Numele afacerii';
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
            ro
          </span>
        </div>
        <div className="flex flex-col gap-4 p-4">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-lg font-semibold">Plimbare cu barca la apus</p>
            <p className="text-sm text-muted">1 h 30 min · Debarcaderul central</p>
            <p className="mt-2">
              de la <strong>{formatMoney(12000, currency)}</strong>
            </p>
            <p className="mt-1 text-sm font-semibold text-brand-strong underline">
              Vezi detalii și orar
            </p>
            <span className="mt-3 flex min-h-12 items-center justify-center rounded-2xl bg-brand font-semibold text-on-brand">
              Rezervă acum
            </span>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
            <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-soft-fg">
              <IconTicket size={28} />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-muted">Bilet · {name}</p>
              <p className="font-semibold">Sâmbătă, 18:00 · 2 adulți</p>
              <span className="mt-1 inline-flex rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-soft-fg">
                Valabil
              </span>
            </div>
          </div>
        </div>
      </div>
      <p className="visually-hidden">
        Previzualizare: pagina de rezervări și biletul, cu numele, logoul și culoarea alese.
      </p>
    </BrandScope>
  );
}
