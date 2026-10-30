// Service worker for Musical Trip Planner (installable app / Android TWA).
//
// Rules:
// - /api/* and every non-GET request go straight to the network, untouched and never cached
//   (live schedules, prices, shared plans, the usage counter).
// - Page navigations are network-first. When the network is unreachable they get /offline.html, which
//   shows the visitor's saved plan from localStorage (dates, shows, times, seats, booking references).
//   The planner page itself is not served from cache offline: without the live schedule it can only
//   show a "couldn't load" error, while offline.html shows the plan directly.
// - Same-origin static files (favicon, manifest, icons, events.js) and the pinned PDF/Excel libraries
//   on cdnjs/jsdelivr are served stale-while-revalidate, so exports keep working on a bad connection.
//
// Bump VERSION when this file's caching rules change; old caches are deleted on activate.
const VERSION = 'v1';
const SHELL_CACHE = `mtp-shell-${VERSION}`;
const ASSET_CACHE = `mtp-assets-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/favicon.svg', '/site.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
const CDN_HOSTS = new Set(['cdnjs.cloudflare.com', 'cdn.jsdelivr.net']);
const STATIC_EXT = /\.(?:js|css|svg|png|webmanifest|woff2?)$/;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // offline.html is required; the rest is best effort (icons come from a function).
    await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
    await Promise.all(PRECACHE.slice(1).map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
    for (const key of await caches.keys()) if (key.startsWith('mtp-') && !keep.has(key)) await caches.delete(key);
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (_) {} }
    await self.clients.claim();
  })());
});

function isApi(url) {
  return url.origin === self.location.origin && (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/_vercel/'));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isApi(url)) return; // never intercept or cache the API

  if (req.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }
  const sameOrigin = url.origin === self.location.origin;
  if ((sameOrigin && STATIC_EXT.test(url.pathname) && !url.search) || CDN_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event, req));
  }
  // anything else: browser default (network)
});

async function handleNavigation(event) {
  try {
    const preload = await event.preloadResponse;
    return preload || await fetch(event.request);
  } catch (_) {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(OFFLINE_URL)) || new Response('<h1>You’re offline</h1>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(req);
  const network = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(network); return cached; }
  return (await network) || (await caches.match(req)) || Response.error();
}

// Lets the page ask the waiting worker to take over immediately (not used yet; future "update" banner).
self.addEventListener('message', event => { if (event.data === 'skipWaiting') self.skipWaiting(); });
