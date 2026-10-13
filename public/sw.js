// Service Worker for Twisted Ring // Auto-Updating Progressive Web App
const CACHE_VERSION = 'v1791884566473';
const STATIC_CACHE = `twisted-ring-static-${CACHE_VERSION}`;
const ASSET_CACHE = `twisted-ring-assets-${CACHE_VERSION}`;

// Core assets to pre-cache on install for offline boot
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable.png',
  '/icons/icon.svg',
  '/version.json'
];

self.addEventListener('install', (event) => {
  // Force new service worker to immediately become active without waiting
  self.skipWaiting();

  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Pre-caching warning:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  // Prune any previous caches from older versions
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== STATIC_CACHE && key !== ASSET_CACHE) {
            console.log('[SW] Purging outdated cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      // Claim all clients immediately so the new SW controls all tabs/windows
      return self.clients.claim();
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Only handle GET requests
  if (req.method !== 'GET') {
    return;
  }

  // 2. Bypass Service Worker cache completely for Supabase, WebSockets, Analytics, or external APIs
  if (
    url.hostname.includes('supabase.co') ||
    url.protocol.startsWith('ws') ||
    url.protocol.startsWith('chrome-extension')
  ) {
    return;
  }

  // 3. Navigation requests (HTML documents like index.html or root /)
  // CRITICAL AUTO-UPDATE RULE: ALWAYS NETWORK-FIRST.
  // This guarantees that installed mobile apps fetch fresh index.html from server on every load,
  // pointing to the latest Vite-hashed JavaScript and CSS bundles.
  if (req.mode === 'navigate' || req.destination === 'document' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(req, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Fallback to cached index.html only if completely offline
          return caches.match(req).then((cachedResponse) => {
            return cachedResponse || caches.match('/index.html');
          });
        })
    );
    return;
  }

  // 4. Version metadata (version.json): ALWAYS NETWORK-FIRST, never serve stale version
  if (url.pathname === '/version.json') {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((networkResponse) => {
          return networkResponse;
        })
        .catch(() => {
          return caches.match(req);
        })
    );
    return;
  }

  // 5. Static Assets (Vite hashed bundles in /assets/, icons, fonts, 3D models)
  // Cache-First with Network fallback
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached file, but trigger background fetch for non-hashed resources
        if (!url.pathname.startsWith('/assets/')) {
          fetch(req).then((freshResponse) => {
            if (freshResponse && freshResponse.status === 200) {
              caches.open(ASSET_CACHE).then((cache) => cache.put(req, freshResponse));
            }
          }).catch(() => {});
        }
        return cachedResponse;
      }

      return fetch(req).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
          return networkResponse;
        }

        const responseClone = networkResponse.clone();
        caches.open(ASSET_CACHE).then((cache) => {
          cache.put(req, responseClone);
        });

        return networkResponse;
      });
    })
  );
});
