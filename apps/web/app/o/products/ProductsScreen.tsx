'use client';

import type { ProductDto } from '@ap/contracts';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import {
  IconCalendarPlus,
  IconExternal,
  IconGlobe,
  IconMessage,
  IconPercent,
} from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { operatorApi } from '@/lib/endpoints';
import { formatBps } from '@/lib/format';
import { formatDuration } from '@/lib/i18n';
import { translatedLanguages } from '@/lib/tripTranslations';
import { errorMessage, useApi } from '@/lib/useApi';
import { useT } from '@/components/I18nProvider';
import { useOperator } from '../OperatorContext';
import { ProductForm } from './ProductForm';
import { SlotsDialog, UpcomingSlots } from './Slots';
import { CustomerFieldsForm, TranslationsForm, TripCommissionForm } from './TripExtras';

type ExtraKind = 'customer' | 'translations' | 'commission';

const EXTRA_TITLES = {
  customer: 'catalog.extras.customerTitle',
  translations: 'catalog.extras.translationsTitle',
  commission: 'catalog.extras.commissionTitle',
} as const;

export function ProductsScreen() {
  const i18n = useT();
  const { t, tp } = i18n;
  const products = useApi('operator-products', (signal) => operatorApi.products({ signal }));
  const [slotsFor, setSlotsFor] = useState<ProductDto | null>(null);
  const [editing, setEditing] = useState<ProductDto | null>(null);
  const [extras, setExtras] = useState<{ product: ProductDto; kind: ExtraKind } | null>(null);
  const [openSlots, setOpenSlots] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function replace(product: ProductDto) {
    products.setData((prev) => (prev ?? []).map((p) => (p.id === product.id ? product : p)));
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('catalog.products.title')}
        description={t('catalog.products.description')}
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="products-title" className="flex flex-col gap-3 xl:order-2">
          <h2 id="products-title" className="text-xl font-semibold">
            {t('catalog.products.yourTrips')}
          </h2>
          {products.loading && !products.data ? <LoadingBlock /> : null}
          {products.error ? (
            <Alert
              tone="error"
              action={
                <Button variant="secondary" onClick={products.reload}>
                  {t('common.retry')}
                </Button>
              }
            >
              {errorMessage(products.error, i18n)}
            </Alert>
          ) : null}
          {products.data?.length === 0 ? (
            <p className="text-muted">{t('catalog.products.empty')}</p>
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
                  onExtras={(kind) => setExtras({ product, kind })}
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
            setNotice(t('catalog.products.added', { name: product.name }));
            setSlotsFor(product);
          }}
        />
      </div>

      <Dialog
        open={!!slotsFor}
        onClose={() => setSlotsFor(null)}
        title={slotsFor ? t('catalog.products.slotsDialogTitle', { name: slotsFor.name }) : ''}
      >
        {slotsFor ? (
          <SlotsDialog
            key={slotsFor.id}
            product={slotsFor}
            onCreated={(created) => {
              setNotice(
                created === 0
                  ? t('catalog.products.slotsExisted')
                  : tp('catalog.products.slotsCreated', created),
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
        title={editing ? t('catalog.products.editTitle', { name: editing.name }) : ''}
      >
        {editing ? (
          <ProductForm
            key={editing.id}
            product={editing}
            framed={false}
            onSaved={(product) => {
              replace(product);
              setNotice(t('catalog.products.saved', { name: product.name }));
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={!!extras}
        onClose={() => setExtras(null)}
        title={extras ? t(EXTRA_TITLES[extras.kind], { name: extras.product.name }) : ''}
      >
        {extras ? (
          <ExtrasForm
            key={`${extras.product.id}:${extras.kind}`}
            kind={extras.kind}
            product={extras.product}
            onSaved={(product) => {
              replace(product);
              setNotice(t('catalog.products.saved', { name: product.name }));
              setExtras(null);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function ExtrasForm({
  kind,
  ...props
}: {
  kind: ExtraKind;
  product: ProductDto;
  onSaved: (product: ProductDto) => void;
}) {
  if (kind === 'customer') return <CustomerFieldsForm {...props} />;
  if (kind === 'translations') return <TranslationsForm {...props} />;
  return <TripCommissionForm {...props} />;
}

function ProductCard({
  product,
  slotsOpen,
  onToggleSlots,
  onAddSlots,
  onEdit,
  onExtras,
  onChanged,
}: {
  product: ProductDto;
  slotsOpen: boolean;
  onToggleSlots: () => void;
  onAddSlots: () => void;
  onEdit: () => void;
  onExtras: (kind: ExtraKind) => void;
  onChanged: (product: ProductDto, message: string) => void;
}) {
  const { tenant } = useOperator();
  const i18n = useT();
  const { t, tp, lang } = i18n;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const external = product.managedExternally;
  const languages = translatedLanguages(product);

  async function toggleActive() {
    setBusy(true);
    setError(null);
    try {
      const updated = await operatorApi.updateProduct(product.id, { active: !product.active });
      onChanged(
        updated,
        updated.active
          ? t('catalog.products.resumed', { name: updated.name })
          : t('catalog.products.paused', { name: updated.name }),
      );
    } catch (err) {
      setError(errorMessage(err, i18n));
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
              {formatDuration(product.durationMinutes, lang)} · /{product.slug}
              {product.meetingPoint ? ` · ${product.meetingPoint}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {product.active ? null : (
              <StatusChip tone="warning">{t('catalog.products.pausedChip')}</StatusChip>
            )}
            {external ? (
              <StatusChip tone="brand">{t('catalog.products.externalChip')}</StatusChip>
            ) : null}
            {product.commissionRateBps !== null ? (
              <StatusChip tone="brand">
                {t('catalog.extras.commissionChip', {
                  rate: formatBps(product.commissionRateBps, lang),
                })}
              </StatusChip>
            ) : null}
            {languages.length > 0 ? (
              <StatusChip>
                {t('catalog.extras.translatedChip', {
                  languages: languages.map((code) => code.toUpperCase()).join(' · '),
                })}
              </StatusChip>
            ) : null}
            {product.questions.length > 0 ? (
              <StatusChip>
                {tp('catalog.extras.questionsChip', product.questions.length)}
              </StatusChip>
            ) : null}
          </div>
        </div>
        <table className="w-full border-collapse text-left text-sm">
          <caption className="visually-hidden">
            {t('catalog.products.pricesCaption', { name: product.name })}
          </caption>
          <thead>
            <tr className="border-b border-line text-muted">
              <th scope="col" className="py-1.5 font-semibold">
                {t('catalog.products.colTicket')}
              </th>
              <th scope="col" className="py-1.5 text-right font-semibold">
                {t('catalog.products.colPrice')}
              </th>
            </tr>
          </thead>
          <tbody>
            {product.prices.map((price) => (
              <tr key={price.id} className="border-b border-line last:border-0">
                <th scope="row" className="py-1.5 font-normal">
                  {price.label}
                  {price.kind === 'extra' ? (
                    <span className="text-muted">
                      {' '}
                      ·{' '}
                      {price.commissionable
                        ? t('catalog.products.extraTag')
                        : t('catalog.products.extraNoCommission')}
                    </span>
                  ) : price.seats !== 1 ? (
                    <span className="text-muted">
                      {' '}
                      ·{' '}
                      {price.seats === 0
                        ? t('catalog.products.noSeat')
                        : tp('catalog.products.seats', price.seats)}
                    </span>
                  ) : null}
                  {price.taxRateBps > 0 ? (
                    <span className="text-muted">
                      {' '}
                      · {t('catalog.products.vat', { rate: formatBps(price.taxRateBps, lang) })}
                    </span>
                  ) : null}
                </th>
                <td className="py-1.5 text-right">
                  <MoneyText
                    amountMinor={price.amountMinor}
                    currency={product.currency}
                    lang={lang}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {external ? (
          <p className="text-sm text-muted">
            {t('catalog.products.externalBeforeLink')}{' '}
            <Link href="/o/sources" className="font-semibold text-brand underline">
              {t('catalog.products.externalLink')}
            </Link>
            {t('catalog.products.externalAfterLink')}
          </p>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {external ? null : (
            <Button icon={<IconCalendarPlus />} onClick={onAddSlots} className="col-span-2">
              {t('catalog.products.addSlots')}
            </Button>
          )}
          <Button
            variant="secondary"
            aria-expanded={slotsOpen}
            aria-controls={`slots-${product.id}`}
            onClick={onToggleSlots}
            className="col-span-2"
          >
            {slotsOpen ? t('catalog.products.hideSlots') : t('catalog.products.showSlots')}
          </Button>
          {external ? null : (
            <Button variant="secondary" onClick={onEdit}>
              {t('catalog.products.edit')}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => void toggleActive()}
            loading={busy}
            loadingText={t('catalog.products.saving')}
          >
            {product.active ? t('catalog.products.pause') : t('catalog.products.resume')}
          </Button>
          {product.active ? (
            <a
              href={`/b/${encodeURIComponent(tenant.slug)}/${encodeURIComponent(product.slug)}`}
              target="_blank"
              rel="noopener"
              className="col-span-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 font-semibold text-brand hover:bg-brand-soft"
            >
              <IconExternal />
              {t('catalog.products.viewPublic')}
            </a>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="text-sm font-semibold text-muted">{t('catalog.extras.heading')}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button variant="secondary" icon={<IconMessage />} onClick={() => onExtras('customer')}>
              {t('catalog.extras.customerButton')}
            </Button>
            <Button
              variant="secondary"
              icon={<IconGlobe />}
              onClick={() => onExtras('translations')}
            >
              {t('catalog.extras.translationsButton')}
            </Button>
            <Button
              variant="secondary"
              icon={<IconPercent />}
              onClick={() => onExtras('commission')}
            >
              {t('catalog.extras.commissionButton')}
            </Button>
          </div>
        </div>
        <div id={`slots-${product.id}`} hidden={!slotsOpen}>
          {slotsOpen ? <UpcomingSlots product={product} /> : null}
        </div>
      </div>
    </Card>
  );
}
