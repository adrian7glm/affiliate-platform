'use client';

import { Alert } from '@/components/Alert';
import { useSession } from '@/components/AuthGate';
import { Button } from '@/components/Button';
import { IconSun } from '@/components/icons';
import { QrCode } from '@/components/QrCode';
import { ShareActions } from '@/components/ShareActions';
import { LoadingBlock } from '@/components/Spinner';
import { useAffiliateHome } from '@/lib/useAffiliateHome';
import { errorMessageRo } from '@/lib/useApi';
import { useWakeLock } from '@/lib/useWakeLock';

/**
 * The affiliate's QR code, shown to tourists. Renders from the saved home payload, so it works
 * without a connection; keeps the screen awake while open.
 */
export function QrScreen() {
  const { membership } = useSession();
  const home = useAffiliateHome();
  const wake = useWakeLock(true);
  const link = home.data?.primaryLink;
  const tenantName = home.data?.tenant.name ?? membership.tenantName;

  return (
    <div className="page-x mx-auto flex max-w-xl flex-col items-center gap-4 pt-4 text-center">
      <h1 className="visually-hidden">Codul meu QR</h1>

      {!link && home.loading ? <LoadingBlock /> : null}
      {!link && home.error ? (
        <Alert
          tone="error"
          title="Codul QR nu este disponibil"
          className="w-full text-left"
          action={
            <Button variant="secondary" onClick={home.reload}>
              Încearcă din nou
            </Button>
          }
        >
          {errorMessageRo(home.error)} Deschide aplicația o dată cu internet ca să salvăm codul pe
          telefon.
        </Alert>
      ) : null}

      {link ? (
        <>
          <section
            aria-labelledby="qr-title"
            className="qr-surface flex w-full flex-col items-center gap-3 rounded-[2rem] p-5 shadow-sm"
          >
            <p id="qr-title" className="text-2xl font-extrabold leading-tight">
              Scanează și rezervă
              <span className="block text-lg font-semibold text-neutral-600" lang="en">
                Scan to book
              </span>
            </p>
            <QrCode
              value={link.qrUrl}
              label={`Cod QR pentru rezervări la ${tenantName}`}
              level="M"
              className="w-full max-w-[min(100%,calc(100dvh_-_24rem))] min-w-56"
            />
            <p className="text-xl font-bold">{tenantName}</p>
          </section>

          {home.stale ? (
            <p className="text-sm text-muted">
              Fără conexiune: codul afișat este cel salvat pe telefon.
            </p>
          ) : null}

          <div className="w-full">
            <ShareActions
              url={link.url}
              title={tenantName}
              text={`Rezervă o excursie cu ${tenantName}:`}
            />
          </div>

          {wake.supported ? (
            <p className="flex items-center gap-2 text-sm text-muted" role="status">
              <IconSun size={18} />
              {wake.active
                ? 'Ecranul rămâne aprins cât timp codul e deschis.'
                : 'Ecranul se poate stinge singur.'}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
