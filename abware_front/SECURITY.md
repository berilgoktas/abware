# Güvenlik Önlemleri

Bu dokümanda projede uygulanan güvenlik önlemleri açıklanmaktadır.

## ✅ Uygulanan Güvenlik Önlemleri

### 1. Content Security Policy (CSP)
**Dosya:** `public/_headers`

CSP header'ları ile XSS saldırılarına karşı koruma sağlanmıştır:
- Script'ler sadece kendi domain'inizden yüklenebilir
- Inline script'ler engellenmiştir (unsafe-inline geçici olarak aktif, kaldırılabilir)
- API istekleri sadece belirlenen domain'lere yapılabilir
- Frame embedding engellenmiştir

**Test:**
```javascript
// Browser console'da deneyin - engellenmeliş
eval("alert('XSS')");
```

### 2. Input Sanitization (DOMPurify)
**Dosya:** `src/sanitize.js`

Tüm kullanıcı inputları DOMPurify ile temizlenmektedir:
- `sanitizeString()` - HTML tag'leri engeller
- `sanitizeHTML()` - Sadece güvenli HTML tag'lerine izin verir
- `sanitizeFormData()` - Tüm form verilerini temizler

**Kullanım:**
```javascript
import { sanitizeString, sanitizeHTML } from './sanitize';

const cleanName = sanitizeString(userName);
const cleanDesc = sanitizeHTML(description);
```

**Uygulanan Dosyalar:**
- ✅ `src/ProductForm.jsx` - Ürün ekleme formu
- ✅ `src/StockInPage.jsx` - Stok giriş/çıkış formu

### 3. Console Temizleme
**Dosya:** `vite.config.js`

Production build'inde tüm console.log'lar otomatik olarak kaldırılır:
- `drop_console: true` - console.log kaldırılır
- `drop_debugger: true` - debugger statements kaldırılır
- `pure_funcs` - console.info, console.debug, console.warn kaldırılır

**Test:**
```bash
npm run build
npm run preview
# Console'da hiç log olmamalı
```

### 4. Güvenlik Header'ları
**Dosya:** `public/_headers`

Ek güvenlik header'ları:
- `X-Frame-Options: DENY` - Clickjacking koruması
- `X-Content-Type-Options: nosniff` - MIME type sniffing engelleme
- `X-XSS-Protection: 1; mode=block` - XSS filtresi aktif
- `Referrer-Policy: strict-origin-when-cross-origin` - Referrer bilgisi koruması
- `Permissions-Policy` - Kamera, mikrofon, geolocation izinleri

## ⚠️ Hala Yapılması Gerekenler (Backend Gerekli)

### 1. HttpOnly Cookie
Token'ları HttpOnly cookie'de saklamak için backend değişikliği gerekli.

**Avantaj:**
- JavaScript'ten token erişilemez
- XSS saldırısında token çalınamaz

### 2. CSRF Token
Backend'de CSRF token implementasyonu.

### 3. Rate Limiting
Login ve API endpoint'lerinde rate limiting.

### 4. JWT Signature Validation
Backend'de JWT signature kontrolü.

## 🔒 Güvenlik Best Practices

### LocalStorage Kullanımı
- ✅ Token localStorage'da (geçici çözüm)
- ⚠️ İdeal: HttpOnly cookie kullanılmalı
- ✅ Token şifrelenmiş değil ama CSP ile korunmuş

### Yetkilendirme
- ✅ Frontend'de view kontrolü var
- ⚠️ Backend'de de yetki kontrolü olmalı
- ✅ Her API isteğinde token gönderiliyor

### Input Validation
- ✅ Frontend'de DOMPurify ile sanitization
- ⚠️ Backend'de de validation yapılmalı
- ✅ XSS koruması aktif

## 🧪 Test Senaryoları

### XSS Testi
1. Ürün adı alanına şunu girin:
   ```html
   <script>alert('XSS')</script>
   <img src=x onerror="alert('XSS')">
   ```
2. Kaydet
3. Zararlı kod temizlenmiş olmalı

### CSP Testi
1. Browser console'u açın
2. Şunu çalıştırın:
   ```javascript
   eval("alert('test')");
   ```
3. CSP tarafından engellenmeliş

### Console Testi
1. Production build yapın:
   ```bash
   npm run build
   npm run preview
   ```
2. Browser console'da log olmamalı

## 📊 Güvenlik Puanı

| Kategori | Durum | Puan |
|----------|-------|------|
| XSS Koruması | ✅ CSP + DOMPurify | 9/10 |
| CSRF Koruması | ⚠️ CORS var, CSRF token yok | 6/10 |
| Token Güvenliği | ⚠️ localStorage, HttpOnly yok | 5/10 |
| Input Validation | ✅ Frontend sanitization | 8/10 |
| Header Security | ✅ CSP + Security headers | 9/10 |
| Console Security | ✅ Production'da temiz | 10/10 |
| **TOPLAM** | | **7.8/10** |

## 🚀 Deployment Kontrolü

Deploy etmeden önce kontrol edin:
- [ ] `public/_headers` dosyası var mı?
- [ ] `npm run build` başarılı mı?
- [ ] Production'da console.log var mı?
- [ ] CSP header'ları çalışıyor mu?
- [ ] DOMPurify yüklü mü? (`package.json` kontrol)

## 📝 Notlar

- Development modunda console.log'lar aktif (isDevelopment kontrolü ile)
- Production'da tüm console.log'lar otomatik kaldırılıyor
- Token localStorage'da ama gelecekte HttpOnly cookie'ye geçilmeli
- Backend API'de de güvenlik kontrolleri olması önemli

## 🔗 Kaynaklar

- [OWASP XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [CSP Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [DOMPurify GitHub](https://github.com/cure53/DOMPurify)

