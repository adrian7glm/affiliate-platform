'use client';

import type { CreateProductBody, ProductDto, UpdateProductBody } from '@ap/contracts';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field, INPUT_CLASSES, TextareaField } from '@/components/Field';
import { IconPlus, IconX } from '@/components/icons';
import { isApiError } from '@/lib/api';
import { operatorApi } from '@/lib/endpoints';
import { minorToInput, parseMoneyInput, percentToBps, priceCode, slugify } from '@/lib/format';
import { errorMessageRo } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';

interface PriceDraft {
  key: string;
  /** Set for ticket types that already exist. */
  id?: string;
  label: string;
  amount: string;
  tax: string;
  seats: string;
}

let priceCounter = 0;
function newPrice(label = '', amount = '', seats = '1', tax = '0', id?: string): PriceDraft {
  priceCounter += 1;
  return { key: `price-${priceCounter}`, id, label, amount, tax, seats };
}

function defaultPrices(): PriceDraft[] {
  return [newPrice('Adult'), newPrice('Copil (3–12 ani)')];
}

/**
 * Create or edit a trip: name, booking page address, details and ticket types. When editing,
 * ticket types removed here stop being sold but stay on the bookings already made.
 */
export function ProductForm({
  product,
  onSaved,
  framed = true,
}: {
  /** The trip to edit; empty for a new trip. */
  product?: ProductDto;
  onSaved: (product: ProductDto) => void;
  /** Inside a card with its own title (the "new trip" form) or bare (inside a dialog). */
  framed?: boolean;
}) {
  const { tenant } = useOperator();
  const editing = !!product;
  const [name, setName] = useState(product?.name ?? '');
  const [slug, setSlug] = useState(product?.slug ?? '');
  const [slugEdited, setSlugEdited] = useState(editing);
  const [description, setDescription] = useState(product?.description ?? '');
  const [duration, setDuration] = useState(String(product?.durationMinutes ?? 90));
  const [meetingPoint, setMeetingPoint] = useState(product?.meetingPoint ?? '');
  const [prices, setPrices] = useState<PriceDraft[]>(() =>
    product
      ? product.prices.map((p) =>
          newPrice(
            p.label,
            minorToInput(p.amountMinor, product.currency),
            String(p.seats),
            String(p.taxRateBps / 100),
            p.id,
          ),
        )
      : defaultPrices(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function updatePrice(key: string, patch: Partial<PriceDraft>) {
    setPrices((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    const cleanSlug = slugify(slug || name);
    if (!name.trim()) next.name = 'Scrie numele excursiei.';
    if (!cleanSlug) next.slug = 'Adresa poate avea doar litere mici, cifre și cratime.';
    const minutes = Number(duration);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440)
      next.duration = 'Între 5 și 1440 de minute.';

    const usedCodes = new Set<string>();
    const bodyPrices: (CreateProductBody['prices'][number] & { id?: string })[] = [];
    for (const price of prices) {
      const amountMinor = parseMoneyInput(price.amount, tenant.currency);
      const taxRateBps = price.tax.trim() ? percentToBps(price.tax) : 0;
      const seats = Number(price.seats);
      if (!price.label.trim()) next[price.key] = 'Scrie denumirea biletului.';
      else if (amountMinor === null) next[price.key] = 'Scrie prețul, ex. 120 sau 99,50.';
      else if (taxRateBps === null) next[price.key] = 'TVA: un procent între 0 și 100.';
      else if (!Number.isInteger(seats) || seats < 0 || seats > 10)
        next[price.key] = 'Locuri ocupate: între 0 și 10.';
      else {
        let code = priceCode(price.label);
        for (let i = 2; usedCodes.has(code); i++)
          code = `${priceCode(price.label).slice(0, 36)}_${i}`;
        usedCodes.add(code);
        bodyPrices.push({
          ...(price.id ? { id: price.id } : {}),
          code,
          label: price.label.trim(),
          amountMinor,
          taxRateBps,
          seats,
        });
      }
    }
    if (prices.length === 0) next.prices = 'Adaugă cel puțin un preț.';
    if (prices.length > 20) next.prices = 'Cel mult 20 de tipuri de bilet.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      let saved: ProductDto;
      if (product) {
        const body: UpdateProductBody = {
          name: name.trim(),
          slug: cleanSlug,
          description: description.trim() || null,
          durationMinutes: minutes,
          meetingPoint: meetingPoint.trim() || null,
          // Existing ticket types keep their code; new ones get one from their name.
          prices: bodyPrices.map(({ id, code, ...rest }) =>
            id ? { id, ...rest } : { code, ...rest },
          ),
        };
        saved = await operatorApi.updateProduct(product.id, body);
      } else {
        saved = await operatorApi.createProduct({
          name: name.trim(),
          slug: cleanSlug,
          description: description.trim() || undefined,
          durationMinutes: minutes,
          meetingPoint: meetingPoint.trim() || undefined,
          prices: bodyPrices,
        });
        setName('');
        setSlug('');
        setSlugEdited(false);
        setDescription('');
        setMeetingPoint('');
        setPrices(defaultPrices());
      }
      onSaved(saved);
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        setErrors({ slug: 'Altă excursie folosește deja această adresă. Alege alta.' });
      } else {
        setError(errorMessageRo(err));
      }
    } finally {
      setBusy(false);
    }
  }

  const fields = (
    <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-4">
      <Field
        label="Nume"
        hint="Ex. „Plimbare cu barca la apus”."
        name="name"
        autoComplete="off"
        required
        maxLength={120}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!slugEdited) setSlug(slugify(e.target.value));
        }}
        error={errors.name}
      />
      <Field
        label="Adresa în pagina de rezervări"
        hint={
          editing
            ? `/b/${tenant.slug}/${slug || 'nume-excursie'} · Linkurile și codurile QR ale afiliaților merg în continuare.`
            : `/b/${tenant.slug}/${slug || 'nume-excursie'}`
        }
        name="slug"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={80}
        value={slug}
        onChange={(e) => {
          setSlug(e.target.value.toLowerCase());
          setSlugEdited(true);
        }}
        error={errors.slug}
      />
      <TextareaField
        label="Descriere"
        name="description"
        optionalText="opțional"
        maxLength={4000}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Durata (minute)"
          name="duration"
          inputMode="numeric"
          autoComplete="off"
          required
          value={duration}
          onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))}
          error={errors.duration}
        />
        <Field
          label="Punct de întâlnire"
          name="meetingPoint"
          optionalText="opțional"
          autoComplete="off"
          maxLength={400}
          value={meetingPoint}
          onChange={(e) => setMeetingPoint(e.target.value)}
        />
      </div>

      <fieldset className="min-w-0">
        <legend className="mb-1.5 font-semibold">Prețuri ({tenant.currency})</legend>
        <p className="mb-3 text-sm text-muted">
          Prețul final plătit de client, cu TVA inclus. „Locuri” = câte locuri ocupă un bilet (0
          pentru copii în brațe).
          {editing ? ' Biletele șterse nu se mai vând, dar rămân pe rezervările făcute deja.' : ''}
        </p>
        <ol className="flex flex-col gap-3">
          {prices.map((price, index) => (
            <li key={price.key} className="rounded-2xl border border-line p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_5rem_5rem_auto]">
                <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                  <span className="text-sm font-semibold">Bilet</span>
                  <input
                    className={INPUT_CLASSES}
                    autoComplete="off"
                    value={price.label}
                    maxLength={80}
                    onChange={(e) => updatePrice(price.key, { label: e.target.value })}
                    aria-invalid={!!errors[price.key] || undefined}
                    aria-describedby={errors[price.key] ? `${price.key}-error` : undefined}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">Preț</span>
                  <input
                    className={INPUT_CLASSES}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    value={price.amount}
                    onChange={(e) => updatePrice(price.key, { amount: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">TVA %</span>
                  <input
                    className={INPUT_CLASSES}
                    inputMode="decimal"
                    autoComplete="off"
                    value={price.tax}
                    onChange={(e) => updatePrice(price.key, { tax: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">Locuri</span>
                  <input
                    className={INPUT_CLASSES}
                    inputMode="numeric"
                    autoComplete="off"
                    value={price.seats}
                    onChange={(e) =>
                      updatePrice(price.key, { seats: e.target.value.replace(/\D/g, '') })
                    }
                  />
                </label>
                <div className="flex items-end justify-end">
                  <button
                    type="button"
                    className="inline-flex size-12 items-center justify-center rounded-xl text-muted hover:bg-surface-2 disabled:invisible"
                    onClick={() => setPrices((prev) => prev.filter((p) => p.key !== price.key))}
                    disabled={prices.length === 1}
                    aria-label={`Șterge prețul ${index + 1}${price.label ? ` (${price.label})` : ''}`}
                  >
                    <IconX />
                  </button>
                </div>
              </div>
              {errors[price.key] ? (
                <p id={`${price.key}-error`} className="mt-1.5 text-sm font-medium text-danger-fg">
                  {errors[price.key]}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
        {errors.prices ? (
          <p className="mt-2 text-sm font-medium text-danger-fg">{errors.prices}</p>
        ) : null}
        <Button
          variant="ghost"
          icon={<IconPlus />}
          className="mt-2"
          onClick={() => setPrices((prev) => [...prev, newPrice()])}
          disabled={prices.length >= 20}
        >
          Adaugă un preț
        </Button>
      </fieldset>

      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" size="lg" loading={busy} loadingText="Se salvează…">
        {editing ? 'Salvează modificările' : 'Salvează excursia'}
      </Button>
    </form>
  );

  if (!framed) return fields;
  return (
    <Card title="Excursie nouă" className="xl:order-1">
      {fields}
    </Card>
  );
}
