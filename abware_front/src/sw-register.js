export function registerSW() {
  // Development modunda ServiceWorker'ı devre dışı bırak
  if (import.meta.env.DEV) {
    return;
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((registration) => {
        // Service worker güncellemesi kontrolü
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // Yeni service worker hazır, otomatik aktif et ve sayfayı yenile
                newWorker.postMessage({ type: 'SKIP_WAITING' });
                // Kısa bir gecikme ile sayfayı yenile (SW aktif olsun diye)
                setTimeout(() => {
                  window.location.reload();
                }, 100);
              }
            });
          }
        });

        // Service Worker'dan gelen mesajları dinle
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'SW_UPDATED') {
            // Yeni versiyon geldi, sayfayı yenile
            window.location.reload();
          }
        });

        // Periyodik güncelleme kontrolü (her 5 dakikada bir)
        setInterval(() => {
          registration.update();
        }, 5 * 60 * 1000); // 5 dakika

        // Sayfa görünür olduğunda da kontrol et (focus/visibility change)
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) {
            registration.update();
          }
        });

        // İlk yüklemede de kontrol et
        registration.update();
      }).catch((err) => {
        // SW registration failed - hataları sessizce geç
        console.debug('ServiceWorker registration failed:', err);
      });
    });
  }
}

