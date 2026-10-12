'use client';

import type { LinkDto } from '@ap/contracts';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { Field, SelectField } from '@/components/Field';
import { IconPrinter, IconQr } from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { QrCode } from '@/components/QrCode';
import { ShareActions } from '@/components/ShareActions';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { affiliateApi } from '@/lib/endpoints';
import { pluralRo } from '@/lib/i18n';
import { errorMessageRo, useApi } from '@/lib/useApi';

export function linkTitle(link: LinkDto): string {
  return link.label || link.productName || 'Link general';
}

export function LinksScreen() {
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
      setCreated(linkTitle(link));
      setLabel('');
      setProductId('');
    } catch (err) {
      setError(errorMessageRo(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-x mx-auto flex max-w-xl flex-col gap-4">
      <PageHeader
        title="Linkurile mele"
        description="Fiecare link și cod QR îți aduce comision. Fă câte unul pentru fiecare loc unde îl afișezi, ca să vezi ce funcționează."
        backHref="/a"
        backLabel="Acasă"
      />

      <Card title="Link nou">
        <form onSubmit={create} method="post" className="flex flex-col gap-4">
          <SelectField
            label="Excursia"
            hint="Turistul ajunge direct pe pagina excursiei alese."
            name="productId"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">Toate excursiile</option>
            {(products.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <Field
            label="Nume"
            hint="Ca să-l recunoști, de ex. „Afiș recepție” sau „Lift etaj 2”."
            name="label"
            optionalText="opțional"
            maxLength={80}
            autoComplete="off"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          {error ? <Alert tone="error">{error}</Alert> : null}
          {created ? <Alert tone="success">Linkul „{created}” a fost creat.</Alert> : null}
          <Button type="submit" size="lg" block loading={busy} loadingText="Se creează…">
            Creează linkul
          </Button>
        </form>
      </Card>

      {links.loading && !links.data ? <LoadingBlock /> : null}
      {links.error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={links.reload}>
              Încearcă din nou
            </Button>
          }
        >
          {errorMessageRo(links.error)}
        </Alert>
      ) : null}

      {links.data ? (
        <section aria-labelledby="links-title" className="flex flex-col gap-3">
          <h2 id="links-title" className="text-lg font-semibold">
            Toate linkurile ({links.data.length})
          </h2>
          <ul className="flex flex-col gap-3">
            {links.data.map((link) => (
              <li key={link.id}>
                <Card>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold">{linkTitle(link)}</h3>
                        <p className="text-sm text-muted">
                          {link.productName ?? 'Toate excursiile'}
                        </p>
                      </div>
                      {link.active ? null : <StatusChip tone="neutral">Inactiv</StatusChip>}
                    </div>
                    <p className="break-all rounded-xl bg-surface-2 px-3 py-2 font-mono text-sm">
                      {link.url}
                    </p>
                    <dl className="flex gap-6">
                      <div>
                        <dt className="text-sm text-muted">Accesări</dt>
                        <dd className="text-xl font-bold tabular-nums">{link.clicks}</dd>
                      </div>
                      <div>
                        <dt className="text-sm text-muted">Vânzări</dt>
                        <dd className="text-xl font-bold tabular-nums">{link.sales}</dd>
                      </div>
                    </dl>
                    <ShareActions url={link.url} title={linkTitle(link)} size="md" />
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="secondary" icon={<IconQr />} onClick={() => setQrLink(link)}>
                        Cod QR
                      </Button>
                      <ButtonLink
                        href={`/a/kit?link=${link.id}`}
                        variant="secondary"
                        icon={<IconPrinter />}
                      >
                        De tipărit
                      </ButtonLink>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            {pluralRo(
              links.data.reduce((sum, l) => sum + l.sales, 0),
              'vânzare',
              'vânzări',
            )}{' '}
            din toate linkurile.
          </p>
        </section>
      ) : null}

      <Dialog
        open={!!qrLink}
        onClose={() => setQrLink(null)}
        title={qrLink ? linkTitle(qrLink) : ''}
      >
        {qrLink ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <QrCode
              value={qrLink.qrUrl}
              label={`Cod QR pentru ${linkTitle(qrLink)}`}
              className="w-full max-w-80"
            />
            <p className="text-muted">Scanează și rezervă</p>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
