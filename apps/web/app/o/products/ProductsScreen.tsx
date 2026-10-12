'use client';

import type { ProductDto } from '@ap/contracts';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { IconCalendarPlus, IconExternal } from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { operatorApi } from '@/lib/endpoints';
import { formatBps } from '@/lib/format';
import { formatDuration } from '@/lib/i18n';
import { errorMessageRo, useApi } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';
import { ProductForm } from './ProductForm';
import { SlotsDialog, UpcomingSlots } from './Slots';

export function ProductsScreen() {
  const products = useApi('operator-products', (signal) => operatorApi.products({ signal }));
  const [slotsFor, setSlotsFor] = useState<ProductDto | null>(null);
  const [editing, setEditing] = useState<ProductDto | null>(null);
  const [openSlots, setOpenSlots] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function replace(product: ProductDto) {
    products.setData((prev) => (prev ?? []).map((p) => (p.id === product.id ? product : p)));
  }

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
            {(products.data ?? []).map((product) => (
              <li key={product.id}>
                <ProductCard
                  product={product}
                  slotsOpen={openSlots === product.id}
                  onToggleSlots={() =>
                    setOpenSlots((id) => (id === product.id ? null : product.id))
                  }
                  onAddSlots={() => setSlotsFor(product)}
                  onEdit={() => setEditing(product)}
                  onChanged={(updated, message) => {
                    replace(updated);
                    setNotice(message);
                  }}
                />
              </li>
            ))}
          </ul>
        </section>

        <ProductForm
          onSaved={(product) => {
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
                created === 0
                  ? 'Plecările acestea existau deja.'
                  : created === 1
                    ? 'A fost creată o plecare.'
                    : `Au fost create ${created} plecări.`,
              );
              setOpenSlots(slotsFor.id);
              setSlotsFor(null);
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Editează: ${editing.name}` : ''}
      >
        {editing ? (
          <ProductForm
            key={editing.id}
            product={editing}
            framed={false}
            onSaved={(product) => {
              replace(product);
              setNotice(`Modificările la „${product.name}” au fost salvate.`);
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function ProductCard({
  product,
  slotsOpen,
  onToggleSlots,
  onAddSlots,
  onEdit,
  onChanged,
}: {
  product: ProductDto;
  slotsOpen: boolean;
  onToggleSlots: () => void;
  onAddSlots: () => void;
  onEdit: () => void;
  onChanged: (product: ProductDto, message: string) => void;
}) {
  const { tenant } = useOperator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const external = product.managedExternally;

  async function toggleActive() {
    setBusy(true);
    setError(null);
    try {
      const updated = await operatorApi.updateProduct(product.id, { active: !product.active });
      onChanged(
        updated,
        updated.active
          ? `„${updated.name}” se vinde din nou.`
          : `„${updated.name}” e pe pauză: nu mai apare clienților și afiliaților. Biletele vândute rămân valabile.`,
      );
    } catch (err) {
      setError(errorMessageRo(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={product.active ? '' : 'border-dashed'}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">{product.name}</h3>
            <p className="text-sm text-muted">
              {formatDuration(product.durationMinutes)} · /{product.slug}
              {product.meetingPoint ? ` · ${product.meetingPoint}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {product.active ? null : <StatusChip tone="warning">Pe pauză</StatusChip>}
            {external ? <StatusChip tone="brand">Din sistemul tău</StatusChip> : null}
          </div>
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
                    <span className="text-muted">
                      {' '}
                      · {price.seats === 0 ? 'fără loc' : `${price.seats} locuri`}
                    </span>
                  ) : null}
                  {price.taxRateBps > 0 ? (
                    <span className="text-muted"> · TVA {formatBps(price.taxRateBps)}</span>
                  ) : null}
                </th>
                <td className="py-1.5 text-right">
                  <MoneyText amountMinor={price.amountMinor} currency={product.currency} />
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
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {external ? null : (
            <Button icon={<IconCalendarPlus />} onClick={onAddSlots} className="col-span-2">
              Adaugă plecări
            </Button>
          )}
          <Button
            variant="secondary"
            aria-expanded={slotsOpen}
            aria-controls={`slots-${product.id}`}
            onClick={onToggleSlots}
            className="col-span-2"
          >
            {slotsOpen ? 'Ascunde plecările' : 'Vezi și modifică plecările'}
          </Button>
          {external ? null : (
            <Button variant="secondary" onClick={onEdit}>
              Editează
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => void toggleActive()}
            loading={busy}
            loadingText="Se salvează…"
          >
            {product.active ? 'Pune pe pauză' : 'Reia vânzarea'}
          </Button>
          {product.active ? (
            <a
              href={`/b/${encodeURIComponent(tenant.slug)}/${encodeURIComponent(product.slug)}`}
              target="_blank"
              rel="noopener"
              className="col-span-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 font-semibold text-brand hover:bg-brand-soft"
            >
              <IconExternal />
              Vezi pagina pentru clienți
            </a>
          ) : null}
        </div>
        <div id={`slots-${product.id}`} hidden={!slotsOpen}>
          {slotsOpen ? <UpcomingSlots product={product} /> : null}
        </div>
      </div>
    </Card>
  );
}
