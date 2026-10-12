import type { MetadataRoute } from 'next';
import { APP_DESCRIPTION, APP_FULL_NAME, APP_NAME, THEME_COLOR_LIGHT } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/a',
    name: APP_FULL_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    lang: 'ro',
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
        name: 'Arată QR',
        short_name: 'QR',
        url: '/a/qr',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Rezervă acum',
        short_name: 'Rezervă',
        url: '/a/book',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
  };
}
