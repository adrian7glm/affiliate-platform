import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/components/I18nProvider';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from '@/lib/brand';
import { DEFAULT_LANG } from '@/lib/i18n';
import { getServerT, serverLang } from '@/lib/i18n-server';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  const appName = t('common.appName');
  return {
    title: { default: t('common.appFullName'), template: `%s · ${appName}` },
    description: t('common.appDescription'),
    applicationName: appName,
    appleWebApp: { capable: true, title: appName, statusBarStyle: 'default' },
    formatDetection: { telephone: false, email: false, address: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR_LIGHT },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR_DARK },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The provider sets <html lang> to the chosen language once mounted; this is the first guess.
  const lang = await serverLang(undefined, DEFAULT_LANG);
  return (
    <html lang={lang}>
      <body className="antialiased">
        <I18nProvider>{children}</I18nProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
