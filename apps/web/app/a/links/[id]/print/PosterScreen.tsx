'use client';

import { Alert } from '@/components/Alert';
import { useSession } from '@/components/AuthGate';
import { Button } from '@/components/Button';
import { IconPrinter } from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { QrCode } from '@/components/QrCode';
import { LoadingBlock } from '@/components/Spinner';
import { affiliateApi } from '@/lib/endpoints';
import { useAffiliateHome } from '@/lib/useAffiliateHome';
import { errorMessageRo, useApi } from '@/lib/useApi';

/**
 * A5 poster with the link's QR code. On screen it scales to the viewport (container query
 * units), in print it is exactly 148 × 210 mm.
 */
export function PosterScreen({ linkId }: { linkId: string }) {
  const { membership } = useSession();
  const home = useAffiliateHome();
  // There is no single-link endpoint: find it in the affiliate's list.
  const links = useApi('affiliate-links', (signal) => affiliateApi.links({ signal }));
  const link = links.data?.find((l) => l.id === linkId) ?? null;
  const tenantName = home.data?.tenant.name ?? membership.tenantName;

  return (
    <div className="page-x mx-auto flex max-w-xl flex-col gap-4 pb-10 print:max-w-none print:p-0">
      <style>{`
        @page { size: A5 portrait; margin: 0; }
        @media print {
          html, body { background: #fff !important; }
          .poster { width: 148mm !important; max-width: none !important; margin: 0 !important; }
          .poster-sheet { border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
        }
      `}</style>

      <div className="no-print" style={{ paddingTop: 'var(--safe-top)' }}>
        <PageHeader
          title="Afiș A5"
          description="Tipărește-l pe A5 (sau A4 cu „Potrivește în pagină”) și pune-l la recepție."
          backHref="/a/links"
          backLabel="Linkurile mele"
        />
        <Button
          size="lg"
          block
          icon={<IconPrinter />}
          onClick={() => window.print()}
          disabled={!link}
        >
          Tipărește
        </Button>
      </div>

      {links.loading && !links.data ? <LoadingBlock /> : null}
      {links.error ? <Alert tone="error">{errorMessageRo(links.error)}</Alert> : null}
      {links.data && !link ? <Alert tone="error">Linkul nu a fost găsit.</Alert> : null}

      {link ? (
        // The wrapper is the size container; the sheet inside sizes its text in cqi units.
        <div
          className="poster mx-auto w-full"
          style={{ maxWidth: '148mm', containerType: 'inline-size' }}
        >
          <article
            className="poster-sheet qr-surface flex w-full flex-col items-center justify-between overflow-clip rounded-2xl border border-line text-center shadow-sm"
            style={{ aspectRatio: '148 / 210', padding: '7cqi' }}
            aria-label="Previzualizare afiș"
          >
            <header className="flex flex-col items-center" style={{ gap: '1.5cqi' }}>
              <p className="font-extrabold leading-tight" style={{ fontSize: '9cqi' }}>
                {tenantName}
              </p>
              {link.productName ? (
                <p className="font-semibold text-neutral-700" style={{ fontSize: '5.5cqi' }}>
                  {link.productName}
                </p>
              ) : null}
            </header>

            <QrCode
              value={link.qrUrl}
              label={`Cod QR: rezervă la ${tenantName}`}
              level="Q"
              className="w-[72%]"
            />

            <footer className="flex flex-col items-center" style={{ gap: '1cqi' }}>
              <p className="font-extrabold" style={{ fontSize: '8cqi' }}>
                Scanează și rezervă
              </p>
              <p
                className="font-semibold text-neutral-700"
                lang="en"
                style={{ fontSize: '5.5cqi' }}
              >
                Scan &amp; book
              </p>
              <p className="break-all text-neutral-600" style={{ fontSize: '3cqi' }}>
                {link.url}
              </p>
            </footer>
          </article>
        </div>
      ) : null}
    </div>
  );
}
