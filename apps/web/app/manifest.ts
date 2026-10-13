import type { MetadataRoute } from 'next';
import { THEME_COLOR_LIGHT } from '@/lib/brand';
import { getServerT, serverLang } from '@/lib/i18n-server';

/** Install manifest of the affiliate app, in the visitor's language (saved choice or browser). */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const lang = await serverLang();
  const { t } = await getServerT(lang);
  return {
    id: '/a',
    name: t('common.appFullName'),
    short_name: t('common.appName'),
    description: t('common.appDescription'),
    lang,
    start_url: '/a',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f4f6f8',
    theme_color: THEME_COLOR_LIGHT,
    categories: ['business', 'travel'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    shortcuts: [
      {
        name: t('common.appShortcuts.qr'),
        short_name: t('common.appShortcuts.qrShort'),
        url: '/a/qr',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: t('common.appShortcuts.book'),
        short_name: t('common.appShortcuts.bookShort'),
        url: '/a/book',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
  };
}
