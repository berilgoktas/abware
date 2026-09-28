// Swagger UI için token yönetimi
(function() {
    'use strict';
    
    // Token'ı localStorage'dan al
    function getToken() {
        return localStorage.getItem('swagger_token');
    }
    
    // Swagger UI yüklendiğinde token'ı otomatik ekle
    let tokenProcessed = false;
    
    function autoAuthorize() {
        if (tokenProcessed) return;
        
        const token = getToken();
        if (!token) {
            // Token yoksa login sayfasına yönlendir (sadece bir kez ve login sayfasında değilsek)
            if (!window.location.href.includes('/swagger-login')) {
                window.location.href = '/swagger-login';
            }
            return;
        }
        
        // Swagger UI'ın hazır olmasını bekle
        function tryAuthorize() {
            // Swagger UI 3.x ve 4.x için farklı yöntemler
            if (window.ui && window.ui.preauthorizeApiKey) {
                // Swagger UI 4.x için
                try {
                    window.ui.preauthorizeApiKey('Bearer', 'Bearer ' + token);
                    tokenProcessed = true;
                    console.log('Token otomatik olarak authorize edildi (Swagger UI 4.x)');
                    return true;
                } catch (e) {
                    console.warn('preauthorizeApiKey hatası:', e);
                }
            }
            
            // Swagger UI 3.x için veya fallback
            if (window.ui && window.ui.authActions && window.ui.authActions.authorize) {
                try {
                    window.ui.authActions.authorize({
                        Bearer: {
                            name: 'Bearer',
                            schema: {
                                type: 'apiKey',
                                in: 'header',
                                name: 'Authorization',
                                description: 'JWT access token'
                            },
                            value: 'Bearer ' + token
                        }
                    });
                    tokenProcessed = true;
                    console.log('Token otomatik olarak authorize edildi (Swagger UI 3.x)');
                    return true;
                } catch (e) {
                    console.warn('authActions.authorize hatası:', e);
                }
            }
            
            // DOM manipülasyonu ile fallback (en son çare)
            const authBtn = document.querySelector('.btn.authorize, button.authorize-btn');
            if (authBtn && !tokenProcessed) {
                authBtn.click();
                setTimeout(function() {
                    const inputs = document.querySelectorAll('input[type="text"], input[placeholder*="Bearer"], input[placeholder*="token"]');
                    for (let input of inputs) {
                        if (input && !input.value) {
                            input.value = 'Bearer ' + token;
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            
                            // Authorize butonunu bul ve tıkla
                            setTimeout(function() {
                                const authorizeBtn = document.querySelector('.btn-done, button[class*="authorize"], button[class*="btn-done"]');
                                if (authorizeBtn) {
                                    authorizeBtn.click();
                                    tokenProcessed = true;
                                    console.log('Token otomatik olarak authorize edildi (DOM fallback)');
                                }
                            }, 300);
                            break;
                        }
                    }
                }, 500);
                return true;
            }
            
            return false;
        }
        
        // Swagger UI hazır olana kadar dene
        let attempts = 0;
        const maxAttempts = 20; // 10 saniye (20 * 500ms)
        
        const interval = setInterval(function() {
            attempts++;
            if (tryAuthorize() || attempts >= maxAttempts) {
                clearInterval(interval);
                if (attempts >= maxAttempts && !tokenProcessed) {
                    console.warn('Swagger UI hazır değil, token otomatik authorize edilemedi');
                }
            }
        }, 500);
        
        // İlk deneme
        tryAuthorize();
    }
    
    // Sayfa yüklendiğinde veya Swagger UI hazır olduğunda
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoAuthorize);
    } else {
        autoAuthorize();
    }
    
    // Swagger UI'ın yüklenmesini bekle
    window.addEventListener('load', function() {
        setTimeout(autoAuthorize, 500);
    });
    
    // API çağrıları için interceptor (opsiyonel - Swagger UI kendi interceptor'ını kullanır)
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        const token = getToken();
        if (token && args[1]) {
            args[1].headers = args[1].headers || {};
            if (!args[1].headers['Authorization']) {
                args[1].headers['Authorization'] = 'Bearer ' + token;
            }
        }
        return originalFetch.apply(this, args);
    };
})();

