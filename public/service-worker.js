// AirStudio service worker — v1
// Makes AirStudio installable on phones ("Add to Home Screen" / native install
// prompt) and lets the app shell load offline. Pairing + camera streaming still
// need the signaling server (WebRTC media is peer-to-peer once paired).
const VERSION = 'v1';
const SHELL = [
  '/',
  '/index.html',
  '/camera',
  '/studio',
  '/output',
  '/style.css',
  '/manifest.webmanifest',
  '/signal.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  '/icons/favicon-16.png',
];
const CACHE = `airstudio-shell-${VERSION}`;
const PAGES = ['/', '/camera', '/studio', '/output'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Same-origin GET only.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Pages: network first, cache fallback (always serve the latest UI when online).
  if (request.mode === 'navigate' || PAGES.includes(url.pathname)) {
    event.respondWith(
      fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return res;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // Shell assets (CSS, JS, images, manifest): cache first, then network.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return res;
      });
    })
  );
});
