'use client';

import type { CreateProductBody, ProductDto } from '@ap/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { Field, INPUT_CLASSES, TextareaField } from '@/components/Field';
import { IconCalendarPlus, IconPlus, IconX } from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { isManagedExternally } from '@/lib/contracts-ext';
import { operatorApi } from '@/lib/endpoints';
import { formatBps, parseMoneyInput, percentToBps, priceCode, slugify } from '@/lib/format';
import { formatDuration } from '@/lib/i18n';
import { errorMessageRo, useApi } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';
import { SlotsDialog, UpcomingSlots } from './Slots';

interface PriceDraft {
  key: string;
  label: string;
  amount: string;
  tax: string;
  seats: string;
}

let priceCounter = 0;
function newPrice(label = '', amount = '', seats = '1'): PriceDraft {
  priceCounter += 1;
  return { key: `price-${priceCounter}`, label, amount, tax: '0', seats };
}

export function ProductsScreen() {
  const products = useApi('operator-products', (signal) => operatorApi.products({ signal }));
  const [slotsFor, setSlotsFor] = useState<ProductDto | null>(null);
  const [openSlots, setOpenSlots] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Excursii și plecări"
        description="Ce vinzi, la ce prețuri și când pleacă."
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="products-title" className="flex flex-col gap-3 xl:order-2">
          <h2 id="products-title" className="text-xl font-semibold">
            Excursiile tale
          </h2>
          {products.loading && !products.data ? <LoadingBlock /> : null}
          {products.error ? (
            <Alert
              tone="error"
              action={
                <Button variant="secondary" onClick={products.reload}>
                  Încearcă din nou
                </Button>
              }
            >
              {errorMessageRo(products.error)}
            </Alert>
          ) : null}
          {products.data?.length === 0 ? (
            <p className="text-muted">Nu ai încă excursii. Adaugă prima excursie.</p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {(products.data ?? []).map((product) => {
              const external = isManagedExternally(product);
              return (
                <li key={product.id}>
                  <Card>
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="text-lg font-semibold">{product.name}</h3>
                          <p className="text-sm text-muted">
                            {formatDuration(product.durationMinutes)} · /{product.slug}
                            {product.meetingPoint ? ` · ${product.meetingPoint}` : ''}
                          </p>
                        </div>
                        {external ? <StatusChip tone="brand">Din sistemul tău</StatusChip> : null}
                      </div>
                      <table className="w-full border-collapse text-left text-sm">
                        <caption className="visually-hidden">Prețuri pentru {product.name}</caption>
                        <thead>
                          <tr className="border-b border-line text-muted">
                            <th scope="col" className="py-1.5 font-semibold">
                              Bilet
                            </th>
                            <th scope="col" className="py-1.5 text-right font-semibold">
                              Preț
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {product.prices.map((price) => (
                            <tr key={price.id} className="border-b border-line last:border-0">
                              <th scope="row" className="py-1.5 font-normal">
                                {price.label}
                                {price.seats !== 1 ? (
                                  <span className="text-muted"> · {price.seats} locuri</span>
                                ) : null}
                                {price.taxRateBps > 0 ? (
                                  <span className="text-muted">
                                    {' '}
                                    · TVA {formatBps(price.taxRateBps)}
                                  </span>
                                ) : null}
                              </th>
                              <td className="py-1.5 text-right">
                                <MoneyText
                                  amountMinor={price.amountMinor}
                                  currency={product.currency}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {external ? (
                        <p className="text-sm text-muted">
                          Prețurile și plecările vin din{' '}
                          <Link href="/o/sources" className="font-semibold text-brand underline">
                            sistemul tău de rezervări
                          </Link>
                          .
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        {external ? null : (
                          <Button icon={<IconCalendarPlus />} onClick={() => setSlotsFor(product)}>
                            Adaugă plecări
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          aria-expanded={openSlots === product.id}
                          aria-controls={`slots-${product.id}`}
                          onClick={() =>
                            setOpenSlots((id) => (id === product.id ? null : product.id))
                          }
                        >
                          {openSlots === product.id ? 'Ascunde plecările' : 'Vezi plecările'}
                        </Button>
                      </div>
                      <div id={`slots-${product.id}`} hidden={openSlots !== product.id}>
                        {openSlots === product.id ? <UpcomingSlots productId={product.id} /> : null}
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>

        <CreateProductForm
          onCreated={(product) => {
            products.setData((prev) => [...(prev ?? []), product]);
            setNotice(`Excursia „${product.name}” a fost adăugată. Acum adaugă plecările.`);
            setSlotsFor(product);
          }}
        />
      </div>

      <Dialog
        open={!!slotsFor}
        onClose={() => setSlotsFor(null)}
        title={slotsFor ? `Plecări: ${slotsFor.name}` : ''}
      >
        {slotsFor ? (
          <SlotsDialog
            key={slotsFor.id}
            product={slotsFor}
            onCreated={(created) => {
              setNotice(
                created === 1 ? 'A fost creată o plecare.' : `Au fost create ${created} plecări.`,
              );
              setOpenSlots(slotsFor.id);
              setSlotsFor(null);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function CreateProductForm({ onCreated }: { onCreated: (product: ProductDto) => void }) {
  const { tenant } = useOperator();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('90');
  const [meetingPoint, setMeetingPoint] = useState('');
  const [prices, setPrices] = useState<PriceDraft[]>(() => [
    newPrice('Adult'),
    newPrice('Copil (3–12 ani)'),
  ]);
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
    const bodyPrices: CreateProductBody['prices'] = [];
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
        bodyPrices.push({ code, label: price.label.trim(), amountMinor, taxRateBps, seats });
      }
    }
    if (prices.length === 0) next.prices = 'Adaugă cel puțin un preț.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      const product = await operatorApi.createProduct({
        name: name.trim(),
        slug: cleanSlug,
        description: description.trim() || undefined,
        durationMinutes: minutes,
        meetingPoint: meetingPoint.trim() || undefined,
        prices: bodyPrices,
      });
      onCreated(product);
      setName('');
      setSlug('');
      setSlugEdited(false);
      setDescription('');
      setMeetingPoint('');
      setPrices([newPrice('Adult'), newPrice('Copil (3–12 ani)')]);
    } catch (err) {
      setError(errorMessageRo(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Excursie nouă" className="xl:order-1">
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
          hint={`/b/${tenant.slug}/${slug || 'nume-excursie'}`}
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
                  <p
                    id={`${price.key}-error`}
                    className="mt-1.5 text-sm font-medium text-danger-fg"
                  >
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
          >
            Adaugă un preț
          </Button>
        </fieldset>

        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" size="lg" loading={busy} loadingText="Se salvează…">
          Salvează excursia
        </Button>
      </form>
    </Card>
  );
}
