'use client';

import type { LinkDto, ProductDto } from '@ap/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '@/components/Alert';
import { useSession } from '@/components/AuthGate';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { IconDownload, IconPrinter, IconShare } from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock, Spinner } from '@/components/Spinner';
import { affiliateApi } from '@/lib/endpoints';
import { formatMoney, slugify } from '@/lib/format';
import { jpegPdf } from '@/lib/pdf';
import {
  KIT_FORMATS,
  type KitContent,
  type KitFormat,
  type KitFormatSpec,
  canvasBlob,
  displayUrl,
  kitFormat,
  loadLogo,
  normalizeColor,
  renderKitPage,
} from '@/lib/qrKit';
import { useAffiliateHome } from '@/lib/useAffiliateHome';
import { errorMessageRo, useApi } from '@/lib/useApi';
import { linkTitle } from '../links/LinksScreen';

/** Print resolution of the exported files; the on-screen preview is drawn lighter. */
const PRINT_DPI = 300;
const PREVIEW_DPI = 110;
/** Label of the links the kit creates, so the affiliate can tell them apart. */
const KIT_LINK_LABEL = 'Kit QR';
const ALL = '';

type Busy = 'pdf' | 'png' | 'share' | 'print' | null;

/**
 * Ready-to-print QR materials: pick an excursion and a format, get a PDF or image with the
 * operator's logo and color and the affiliate's own tracked link.
 */
export function KitScreen({ linkId, format }: { linkId?: string; format?: string }) {
  const { membership } = useSession();
  const home = useAffiliateHome();
  const links = useApi('affiliate-links', (signal) => affiliateApi.links({ signal }));
  const products = useApi('affiliate-products', (signal) => affiliateApi.products({ signal }));
  const [spec, setSpec] = useState<KitFormatSpec>(() => kitFormat(format));
  // A link chosen in "Linkurile mele" wins until another excursion is picked.
  const [pinnedLinkId, setPinnedLinkId] = useState<string | null>(linkId ?? null);
  const [productId, setProductId] = useState<string>(ALL);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [logoState, setLogoState] = useState<'none' | 'loading' | 'ok' | 'failed'>('none');
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [printUrl, setPrintUrl] = useState<string | null>(null);
  const attempted = useRef(new Set<string>());

  const data = home.data;
  const tenantName = data?.tenant.name ?? membership.tenantName;
  const branding = data?.tenant.branding;
  const pinned = links.data?.find((l) => l.id === pinnedLinkId) ?? null;

  // The pinned link decides the excursion shown as selected.
  useEffect(() => {
    if (pinned) setProductId(pinned.productId ?? ALL);
  }, [pinned]);

  const link: LinkDto | null = useMemo(() => {
    if (pinned) return pinned;
    if (productId === ALL) return data?.primaryLink ?? null;
    return pickKitLink(links.data ?? [], productId);
  }, [pinned, productId, data?.primaryLink, links.data]);

  const product: ProductDto | null =
    (products.data ?? []).find((p) => p.id === (link?.productId ?? productId)) ?? null;

  // An excursion without a link of its own gets one, so its sales are tracked separately.
  useEffect(() => {
    if (pinned || productId === ALL || !links.data || link) return;
    if (attempted.current.has(productId)) return;
    attempted.current.add(productId);
    setCreating(true);
    setCreateError(null);
    affiliateApi
      .createLink({ productId, label: KIT_LINK_LABEL })
      .then((created) => links.setData((prev) => [created, ...(prev ?? [])]))
      .catch((err) => setCreateError(errorMessageRo(err)))
      .finally(() => setCreating(false));
  }, [pinned, productId, links, link]);

  useEffect(() => {
    if (!branding?.logoUrl) {
      setLogo(null);
      setLogoState('none');
      return;
    }
    let cancelled = false;
    setLogoState('loading');
    void loadLogo(branding.logoUrl).then((img) => {
      if (cancelled) return;
      setLogo(img);
      setLogoState(img ? 'ok' : 'failed');
    });
    return () => {
      cancelled = true;
    };
  }, [branding?.logoUrl]);

  const content: KitContent | null = useMemo(() => {
    if (!link || logoState === 'loading') return null;
    return {
      tenantName,
      productName: product?.name ?? null,
      priceText:
        product && product.fromMinor > 0
          ? `de la / from ${formatMoney(product.fromMinor, product.currency)}`
          : null,
      qrUrl: link.qrUrl,
      displayUrl: displayUrl(link.url),
      color: normalizeColor(branding?.primaryColor),
      logo,
    };
  }, [link, logoState, tenantName, product, branding?.primaryColor, logo]);

  // Live preview.
  useEffect(() => {
    if (!content) return;
    let url: string | null = null;
    let cancelled = false;
    void render(spec, content, PREVIEW_DPI, 'image/jpeg', 0.85)
      .then(({ blob }) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
      })
      .catch(() => {
        if (!cancelled) setError('Previzualizarea nu a putut fi desenată pe acest telefon.');
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [spec, content]);

  // Print once the full-resolution image is in the page.
  useEffect(() => {
    if (!printUrl) return;
    const after = () => {
      URL.revokeObjectURL(printUrl);
      setPrintUrl(null);
    };
    window.addEventListener('afterprint', after, { once: true });
    return () => window.removeEventListener('afterprint', after);
  }, [printUrl]);

  const fileBase = `qr-${slugify(product?.name ?? tenantName) || 'afis'}-${spec.id}`;

  async function exportFile(kind: 'pdf' | 'png'): Promise<File> {
    if (!content) throw new Error('not ready');
    if (kind === 'png') {
      const { blob } = await render(spec, content, PRINT_DPI, 'image/png');
      return new File([blob], `${fileBase}.png`, { type: 'image/png' });
    }
    const { blob, width, height } = await render(spec, content, PRINT_DPI, 'image/jpeg', 0.92);
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    const pdf = jpegPdf(jpeg, { width, height }, spec.page);
    return new File([pdf as BlobPart], `${fileBase}.pdf`, { type: 'application/pdf' });
  }

  async function run(kind: Exclude<Busy, null>, action: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setError('Fișierul nu a putut fi generat. Încearcă din nou.');
    } finally {
      setBusy(null);
    }
  }

  const download = (kind: 'pdf' | 'png') =>
    run(kind, async () => {
      const file = await exportFile(kind);
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });

  const share = () =>
    run('share', async () => {
      const file = await exportFile('pdf');
      await navigator.share({ files: [file], title: file.name });
    });

  const print = () =>
    run('print', async () => {
      if (!content) return;
      const { blob } = await render(spec, content, PRINT_DPI, 'image/png');
      setPrintUrl(URL.createObjectURL(blob));
    });

  const canShareFiles = useCanShareFiles();
  const loading = (!data && home.loading) || (!links.data && links.loading);
  const ready = !!content && !creating;

  return (
    <div className="page-x mx-auto flex max-w-xl flex-col gap-4 pb-6">
      <style>{`
        @page { size: ${spec.page.w}mm ${spec.page.h}mm; margin: 0; }
        @media print {
          html, body { background: #fff !important; }
          #content, .page-x { padding: 0 !important; margin: 0 !important; max-width: none !important; min-height: 0 !important; }
          .kit-print { display: block !important; width: ${spec.page.w}mm; height: ${spec.page.h}mm; }
        }
      `}</style>

      <div className="no-print">
        <PageHeader
          title="Kit QR de tipărit"
          description="Materiale gata de tipărit cu codul tău QR. Fiecare scanare și rezervare îți aduce comision."
          backHref="/a"
          backLabel="Acasă"
        />
      </div>

      {loading ? <LoadingBlock /> : null}
      {home.error && !data ? <Alert tone="error">{errorMessageRo(home.error)}</Alert> : null}

      <div className="no-print flex flex-col gap-4">
        <Card title="1. Excursia">
          <fieldset className="flex flex-col gap-2">
            <legend className="visually-hidden">Excursia de pe afiș</legend>
            {[
              { id: ALL, name: 'Toate excursiile', fromMinor: 0, currency: '' },
              ...(products.data ?? []),
            ].map((p) => (
              <label key={p.id || 'all'} className="choice">
                <input
                  type="radio"
                  name="kit-product"
                  value={p.id}
                  checked={productId === p.id}
                  onChange={() => {
                    setPinnedLinkId(null);
                    setProductId(p.id);
                  }}
                />
                <span className="choice-body min-h-14 flex-row! items-center justify-between gap-3">
                  <span className="font-semibold">{p.name}</span>
                  {p.fromMinor > 0 ? (
                    <span className="shrink-0 text-sm">
                      de la {formatMoney(p.fromMinor, p.currency)}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </fieldset>
          {products.error ? (
            <p className="mt-2 text-sm text-danger-fg">{errorMessageRo(products.error)}</p>
          ) : null}
          {link ? (
            <p className="mt-3 text-sm text-muted">
              Link folosit: <strong className="text-fg">{linkTitle(link)}</strong> · {link.clicks}{' '}
              accesări · {link.sales} vânzări
            </p>
          ) : null}
          {creating ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted" role="status">
              <Spinner size={16} /> Pregătim un link pentru această excursie…
            </p>
          ) : null}
          {createError ? (
            <Alert tone="error" className="mt-3">
              {createError}
            </Alert>
          ) : null}
        </Card>

        <Card title="2. Formatul">
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="visually-hidden">Formatul materialului</legend>
            {KIT_FORMATS.map((f) => (
              <label key={f.id} className="choice">
                <input
                  type="radio"
                  name="kit-format"
                  value={f.id}
                  checked={spec.id === f.id}
                  onChange={() => setSpec(f)}
                />
                <span className="choice-body h-full items-start! gap-2 py-3!">
                  <FormatThumb id={f.id} />
                  <span className="font-semibold leading-tight">{f.label}</span>
                  <span className="text-xs leading-snug opacity-80">{f.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </Card>

        <section aria-labelledby="kit-preview-title" className="flex flex-col gap-3">
          <h2 id="kit-preview-title" className="text-lg font-semibold">
            3. Previzualizare
          </h2>
          <div
            className="qr-surface relative mx-auto w-full overflow-hidden rounded-xl border border-line shadow-md"
            style={{ aspectRatio: `${spec.page.w} / ${spec.page.h}`, maxWidth: '26rem' }}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt={`${spec.label}: ${product?.name ?? 'toate excursiile'}, cu codul QR`}
                className="block h-full w-full"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Spinner />
              </div>
            )}
          </div>
          <p className="text-sm text-muted">{spec.howTo}</p>
          {logoState === 'failed' ? (
            <Alert tone="warning">
              Logo-ul operatorului nu a putut fi încărcat, așa că apare numele lui.
            </Alert>
          ) : null}
          {!branding?.logoUrl && data ? (
            <p className="text-sm text-muted">
              Când operatorul își adaugă logo-ul, acesta apare automat pe materiale.
            </p>
          ) : null}
        </section>

        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            block
            icon={<IconDownload />}
            disabled={!ready || !!busy}
            loading={busy === 'pdf'}
            loadingText="Se pregătește PDF-ul…"
            onClick={() => void download('pdf')}
          >
            Descarcă PDF
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              icon={<IconDownload />}
              disabled={!ready || !!busy}
              loading={busy === 'png'}
              onClick={() => void download('png')}
            >
              Imagine PNG
            </Button>
            <Button
              variant="secondary"
              icon={<IconPrinter />}
              disabled={!ready || !!busy}
              loading={busy === 'print'}
              onClick={() => void print()}
            >
              Tipărește
            </Button>
          </div>
          {canShareFiles ? (
            <Button
              variant="ghost"
              block
              icon={<IconShare />}
              disabled={!ready || !!busy}
              loading={busy === 'share'}
              onClick={() => void share()}
            >
              Trimite PDF-ul (WhatsApp, e-mail, tipografie)
            </Button>
          ) : null}
        </div>
      </div>

      {printUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={printUrl} alt="" className="kit-print hidden" onLoad={() => window.print()} />
      ) : null}
    </div>
  );
}

/** The excursion's own kit link, or its only unlabelled link; null means create one. */
export function pickKitLink(links: LinkDto[], productId: string): LinkDto | null {
  const own = links.filter((l) => l.active && l.productId === productId);
  return own.find((l) => l.label === KIT_LINK_LABEL) ?? own.find((l) => !l.label) ?? null;
}

async function render(
  spec: KitFormatSpec,
  content: KitContent,
  dpi: number,
  type: string,
  quality?: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const canvas = document.createElement('canvas');
  try {
    renderKitPage(canvas, spec, content, dpi);
    try {
      const blob = await canvasBlob(canvas, type, quality);
      return { blob, width: canvas.width, height: canvas.height };
    } catch (error) {
      // A logo served without CORS taints the canvas; export without it rather than fail.
      if (!content.logo) throw error;
      renderKitPage(canvas, spec, { ...content, logo: null }, dpi);
      const blob = await canvasBlob(canvas, type, quality);
      return { blob, width: canvas.width, height: canvas.height };
    }
  } finally {
    // Release the bitmap right away: phones cap the total canvas memory.
    canvas.width = 0;
    canvas.height = 0;
  }
}

function useCanShareFiles(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    try {
      const probe = new File([new Uint8Array(1)], 'kit.pdf', { type: 'application/pdf' });
      setCan(typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] }));
    } catch {
      setCan(false);
    }
  }, []);
  return can;
}

/** Tiny schematic of each format for the picker. */
function FormatThumb({ id }: { id: KitFormat }) {
  const common = 'fill-none stroke-current';
  return (
    <svg viewBox="0 0 40 40" width={40} height={40} aria-hidden="true" className="opacity-80">
      {id === 'poster-a4' || id === 'poster-a5' ? (
        <>
          <rect
            x={id === 'poster-a4' ? 9 : 12}
            y={id === 'poster-a4' ? 3 : 8}
            width={id === 'poster-a4' ? 22 : 16}
            height={id === 'poster-a4' ? 31 : 23}
            rx={2}
            className={common}
            strokeWidth={2}
          />
          <rect
            x={id === 'poster-a4' ? 14 : 16}
            y={id === 'poster-a4' ? 13 : 15}
            width={id === 'poster-a4' ? 12 : 8}
            height={id === 'poster-a4' ? 12 : 8}
            className="fill-current"
          />
        </>
      ) : null}
      {id === 'tent' ? (
        <>
          <path d="M6 34 L20 8 L34 34" className={common} strokeWidth={2} strokeLinejoin="round" />
          <rect x={16} y={20} width={8} height={8} className="fill-current" />
        </>
      ) : null}
      {id === 'cards' ? (
        <>
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              x={i % 2 ? 21 : 6}
              y={i < 2 ? 8 : 21}
              width={13}
              height={11}
              rx={1.5}
              className={common}
              strokeWidth={2}
            />
          ))}
        </>
      ) : null}
    </svg>
  );
}
