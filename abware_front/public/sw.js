// Her build'de bu versiyonu güncelle (örn: v3, v4, v5...)
const CACHE_NAME = 'abware-cache-v10';
const PRECACHE_URLS = ['/', '/index.html', '/manifest.webmanifest', '/vite.svg'];

self.addEventListener('install', (event) => {
  // Yeni service worker hemen aktif olsun
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          // Eski cache'leri temizle
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return null;
        })
      )
    ).then(() => {
      // Tüm client'lara hemen yeni service worker'ı bildir
      return self.clients.claim().then(() => {
        // Tüm açık tab'lara yenileme mesajı gönder
        return self.clients.matchAll().then((clients) => {
          clients.forEach((client) => {
            client.postMessage({ type: 'SW_UPDATED', cacheVersion: CACHE_NAME });
          });
        });
      });
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol === 'chrome-extension:' || url.protocol === 'chrome:' || url.protocol === 'about:') {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // API isteklerini SW'de ele alma; tarayıcı doğrudan atsın (CSP ve hata Response sorunu olmasın)
  const isApi = url.pathname.startsWith('/api') || url.hostname === 'webservis-test.abware.com.tr' || url.hostname === 'webservis.abware.com.tr';
  if (isApi) {
    return;
  }

  // index.html için her zaman network'ten al (cache bypass)
  if (url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() => {
        return caches.match('/index.html').then((cached) => cached || new Response('', { status: 503, statusText: 'Service Unavailable' }));
      })
    );
    return;
  }

  // Network-first: önce network, başarısızsa cache
  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        if (response && response.status === 200 && url.pathname !== '/' && url.pathname !== '/index.html') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone).catch(() => {});
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          return caches.match('/index.html').then((fallback) => fallback || new Response('', { status: 503, statusText: 'Service Unavailable' }));
        });
      })
  );
});

// Service worker güncellemesi geldiğinde tüm tab'ları yenile
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting().then(() => {
      // Tüm client'lara yenileme mesajı gönder
      return self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_UPDATED', cacheVersion: CACHE_NAME });
        });
      });
    });
  }
});

