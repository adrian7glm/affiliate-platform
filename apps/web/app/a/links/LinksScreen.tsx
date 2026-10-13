'use client';

import type { LinkDto } from '@ap/contracts';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { Field, SelectField } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { IconPrinter, IconQr } from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { QrCode } from '@/components/QrCode';
import { ShareActions } from '@/components/ShareActions';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { affiliateApi } from '@/lib/endpoints';
import type { Translator } from '@/lib/i18n';
import { errorMessage, useApi } from '@/lib/useApi';

export function linkTitle(link: LinkDto, { t }: Translator): string {
  return link.label || link.productName || t('affiliate.links.general');
}

export function LinksScreen() {
  const i18n = useT();
  const { t } = i18n;
  const links = useApi('affiliate-links', (signal) => affiliateApi.links({ signal }));
  const products = useApi('affiliate-products', (signal) => affiliateApi.products({ signal }));
  const [productId, setProductId] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [qrLink, setQrLink] = useState<LinkDto | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const link = await affiliateApi.createLink({
        productId: productId || null,
        label: label.trim() || undefined,
      });
      links.setData((prev) => [link, ...(prev ?? [])]);
      setCreated(linkTitle(link, i18n));
      setLabel('');
      setProductId('');
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-x mx-auto flex max-w-xl flex-col gap-4">
      <PageHeader
        title={t('affiliate.links.title')}
        description={t('affiliate.links.description')}
        backHref="/a"
        backLabel={t('affiliate.nav.home')}
      />

      <Card title={t('affiliate.links.newTitle')}>
        <form onSubmit={create} method="post" className="flex flex-col gap-4">
          <SelectField
            label={t('affiliate.links.productLabel')}
            hint={t('affiliate.links.productHint')}
            name="productId"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">{t('affiliate.links.allProducts')}</option>
            {(products.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <Field
            label={t('affiliate.links.nameLabel')}
            hint={t('affiliate.links.nameHint')}
            name="label"
            optionalText={t('affiliate.optional')}
            maxLength={80}
            autoComplete="off"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          {error ? <Alert tone="error">{error}</Alert> : null}
          {created ? (
            <Alert tone="success">{t('affiliate.links.created', { name: created })}</Alert>
          ) : null}
          <Button
            type="submit"
            size="lg"
            block
            loading={busy}
            loadingText={t('affiliate.links.creating')}
          >
            {t('affiliate.links.create')}
          </Button>
        </form>
      </Card>

      {links.loading && !links.data ? <LoadingBlock /> : null}
      {links.error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={links.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(links.error, i18n)}
        </Alert>
      ) : null}

      {links.data ? (
        <section aria-labelledby="links-title" className="flex flex-col gap-3">
          <h2 id="links-title" className="text-lg font-semibold">
            {t('affiliate.links.allTitle', { count: links.data.length })}
          </h2>
          <ul className="flex flex-col gap-3">
            {links.data.map((link) => (
              <li key={link.id}>
                <Card>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold">{linkTitle(link, i18n)}</h3>
                        <p className="text-sm text-muted">
                          {link.productName ?? t('affiliate.links.allProducts')}
                        </p>
                      </div>
                      {link.active ? null : (
                        <StatusChip tone="neutral">{t('affiliate.links.inactive')}</StatusChip>
                      )}
                    </div>
                    <p className="break-all rounded-xl bg-surface-2 px-3 py-2 font-mono text-sm">
                      {link.url}
                    </p>
                    <dl className="flex gap-6">
                      <div>
                        <dt className="text-sm text-muted">{t('affiliate.links.clicks')}</dt>
                        <dd className="text-xl font-bold tabular-nums">{link.clicks}</dd>
                      </div>
                      <div>
                        <dt className="text-sm text-muted">{t('affiliate.links.sales')}</dt>
                        <dd className="text-xl font-bold tabular-nums">{link.sales}</dd>
                      </div>
                    </dl>
                    <ShareActions url={link.url} title={linkTitle(link, i18n)} size="md" />
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="secondary" icon={<IconQr />} onClick={() => setQrLink(link)}>
                        {t('affiliate.links.qr')}
                      </Button>
                      <ButtonLink
                        href={`/a/kit?link=${link.id}`}
                        variant="secondary"
                        icon={<IconPrinter />}
                      >
                        {t('affiliate.links.print')}
                      </ButtonLink>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            {t('affiliate.links.totalSales', {
              count: links.data.reduce((sum, l) => sum + l.sales, 0),
            })}
          </p>
        </section>
      ) : null}

      <Dialog
        open={!!qrLink}
        onClose={() => setQrLink(null)}
        title={qrLink ? linkTitle(qrLink, i18n) : ''}
      >
        {qrLink ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <QrCode
              value={qrLink.qrUrl}
              label={t('affiliate.links.qrLabel', { name: linkTitle(qrLink, i18n) })}
              className="w-full max-w-80"
            />
            <p className="text-muted">{t('affiliate.qr.scanToBook')}</p>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
