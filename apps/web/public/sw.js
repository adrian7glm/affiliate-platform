/* Service worker for the affiliate PWA.
 *
 * - Static assets (/_next/static, icons, fonts): cache-first.
 * - App shell of /a and /a/qr: served from cache immediately and refreshed in the background,
 *   so the affiliate QR code opens even without a connection.
 * - Other /a/* and /t/* pages: network-first with a cached fallback.
 * - API reads (GET, from the origin passed as ?api=): network-first with a cached fallback.
 * - Never cached: /o/* (operator back office), API writes, auth and operator endpoints.
 */

const VERSION = 'v1';
const STATIC_CACHE = `ap-static-${VERSION}`;
const PAGES_CACHE = `ap-pages-${VERSION}`;
const API_CACHE = `ap-api-${VERSION}`;
const SHELL_URLS = ['/a', '/a/qr'];
const KNOWN_CACHES = [STATIC_CACHE, PAGES_CACHE, API_CACHE];

const API_ORIGIN = (() => {
  try {
    const api = new URL(self.location.href).searchParams.get('api');
    return api ? new URL(api).origin : null;
  } catch {
    return null;
  }
})();

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGES_CACHE);
      // Precache the shell; a failure (offline install) must not block installation.
      await Promise.all(
        SHELL_URLS.map(async (url) => {
          try {
            const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
            if (response.ok) await cache.put(url, response);
          } catch {
            /* ignore */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('ap-') && !KNOWN_CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    /\.(?:png|svg|ico|webp|avif|jpg|jpeg|woff2?|css)$/.test(url.pathname)
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type !== 'opaque') cache.put(request, response.clone());
  return response;
}

/** Serve the cached shell now, refresh it in the background. */
async function staleWhileRevalidate(event, cacheKey) {
  const cache = await caches.open(PAGES_CACHE);
  const cached = await cache.match(cacheKey);
  const refresh = fetch(event.request)
    .then((response) => {
      if (response.ok) cache.put(cacheKey, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const fresh = await refresh;
  return fresh || offlineResponse();
}

async function networkFirst(request, cacheName, cacheKey) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw error;
  }
}

function offlineResponse() {
  return new Response(
    '<!doctype html><html lang="ro"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fără conexiune</title><body style="font-family:system-ui;padding:2rem;line-height:1.5"><h1>Fără conexiune</h1><p>Verifică internetul și încearcă din nou.</p></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

/** API cache key includes the tenant so two operators' data never mix offline. */
function apiCacheKey(request) {
  const url = new URL(request.url);
  const tenant = request.headers.get('X-Tenant-Id');
  if (tenant) url.searchParams.set('__tenant', tenant);
  return url.toString();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API reads.
  if (API_ORIGIN && url.origin === API_ORIGIN) {
    if (
      url.pathname.startsWith('/operator') ||
      url.pathname.startsWith('/auth') ||
      url.pathname.startsWith('/webhooks') ||
      url.pathname.startsWith('/invites')
    ) {
      return;
    }
    event.respondWith(networkFirst(request, API_CACHE, apiCacheKey(request)));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Operator back office: always network.
  if (url.pathname === '/o' || url.pathname.startsWith('/o/')) return;

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // React Server Component payloads for client-side navigation: let the network handle them.
  if (request.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) return;

  if (request.mode === 'navigate') {
    if (SHELL_URLS.includes(url.pathname)) {
      event.respondWith(staleWhileRevalidate(event, url.pathname));
      return;
    }
    if (url.pathname.startsWith('/a/')) {
      event.respondWith(
        networkFirst(request, PAGES_CACHE, url.pathname).catch(() => offlineResponse()),
      );
      return;
    }
    if (url.pathname.startsWith('/t/')) {
      event.respondWith(
        networkFirst(request, PAGES_CACHE, url.pathname + url.search).catch(() =>
          offlineResponse(),
        ),
      );
    }
  }
});
