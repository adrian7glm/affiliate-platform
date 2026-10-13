'use client';

import { Alert } from '@/components/Alert';
import { useSession } from '@/components/AuthGate';
import { Button } from '@/components/Button';
import { useT } from '@/components/I18nProvider';
import { IconSun } from '@/components/icons';
import { QrCode } from '@/components/QrCode';
import { ShareActions } from '@/components/ShareActions';
import { LoadingBlock } from '@/components/Spinner';
import { useAffiliateHome } from '@/lib/useAffiliateHome';
import { translate } from '@/lib/i18n';
import { errorMessage } from '@/lib/useApi';
import { useWakeLock } from '@/lib/useWakeLock';

/**
 * The affiliate's QR code, shown to tourists. Renders from the saved home payload, so it works
 * without a connection; keeps the screen awake while open.
 */
export function QrScreen() {
  const { membership } = useSession();
  const home = useAffiliateHome();
  const i18n = useT();
  const { t, lang } = i18n;
  const wake = useWakeLock(true);
  const link = home.data?.primaryLink;
  const tenantName = home.data?.tenant.name ?? membership.tenantName;

  return (
    <div className="page-x mx-auto flex max-w-xl flex-col items-center gap-4 pt-4 text-center">
      <h1 className="visually-hidden">{t('affiliate.qr.title')}</h1>

      {!link && home.loading ? <LoadingBlock /> : null}
      {!link && home.error ? (
        <Alert
          tone="error"
          title={t('affiliate.qr.unavailable')}
          className="w-full text-left"
          action={
            <Button variant="secondary" onClick={home.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(home.error, i18n)} {t('affiliate.qr.openOnline')}
        </Alert>
      ) : null}

      {link ? (
        <>
          <section
            aria-labelledby="qr-title"
            className="qr-surface flex w-full flex-col items-center gap-3 rounded-[2rem] p-5 shadow-sm"
          >
            <p id="qr-title" className="text-2xl font-extrabold leading-tight">
              {t('affiliate.qr.scanToBook')}
              {/* Tourists often read English: add it under another language. */}
              {lang === 'en' ? null : (
                <span className="block text-lg font-semibold text-neutral-600" lang="en">
                  {translate('en', 'affiliate.qr.scanToBook')}
                </span>
              )}
            </p>
            <QrCode
              value={link.qrUrl}
              label={t('affiliate.qr.codeLabel', { tenant: tenantName })}
              level="M"
              className="w-full max-w-[min(100%,calc(100dvh_-_24rem))] min-w-56"
            />
            <p className="text-xl font-bold">{tenantName}</p>
          </section>

          {home.stale ? <p className="text-sm text-muted">{t('affiliate.qr.offline')}</p> : null}

          <div className="w-full">
            <ShareActions
              url={link.url}
              title={tenantName}
              text={t('affiliate.qr.shareText', { tenant: tenantName })}
            />
          </div>

          {wake.supported ? (
            <p className="flex items-center gap-2 text-sm text-muted" role="status">
              <IconSun size={18} />
              {wake.active ? t('affiliate.qr.wakeOn') : t('affiliate.qr.wakeOff')}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
