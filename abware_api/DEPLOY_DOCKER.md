## ABWare Backend - Docker ile Kurulum (ZIP paket için)

Bu paket, **Windows host üzerinde Docker (Linux containers)** ile çalışacak şekilde hazırlanmıştır.
Cloudflare Tunnel tarafını sen yönetiyorsun; backend sadece localhost portunda çalışır.

### Yayın adresi
- Prod domain: **`webservis.abware.com.tr`**
- Cloudflare Tunnel tarafında bu domain'i **`http://localhost:5049`** hedefine yönlendirmen yeterli.

### 1) ZIP'i aç
- ZIP'i sunucuda bir klasöre aç (örn: `C:\apps\abware-backend\`)

### 2) `.env` oluştur
- Aynı klasörde `env.example` dosyasını **kopyalayıp** `.env` oluştur.
- İçindeki değerleri doldur:
  - `DB_SERVER`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`
  - `JWT_SECRET_KEY` (prod için güçlü ve gizli)
  - `CORS_ORIGINS` -> `https://webservis.abware.com.tr,https://abwaredemo.netlify.app,https://abware.netlify.app`

### 3) Docker ile çalıştır
PowerShell:

```powershell
cd C:\apps\abware-backend
docker compose up -d --build
```

### 4) Kontrol
- Lokal: `http://localhost:5049`
- Swagger kapalıdır. Açmak istersen `.env` içine `SWAGGER_ENABLED=True` yazıp yeniden başlat:

```powershell
docker compose down
docker compose up -d
```

### 5) Log bakma

```powershell
docker compose logs -f
```

### 5.1) Günlük EUR kuru güncellemesi (16:40)
Ürün TL->EUR dönüşümü ve stok hareket fiyatı için `DovizKurlari` tablosunda günlük kur tutulur.

- Script: `scripts/update_fx_daily.py`
- Mantık: `DovizKurlari` tablosundaki en büyük `Tarih` **bugün** ise işlem yapmaz; küçükse bugünün kurunu çekip ekler.

Windows Task Scheduler örneği:

- Program: `docker`
- Argümanlar:
```powershell
exec abware-backend python scripts/update_fx_daily.py
```
- Çalışma dizini: ZIP’i açtığın klasör (örn. `C:\apps\abware-backend`)

Not: Container adın farklıysa `abware-backend` yerine `docker compose ps` ile görünen service/container adını kullan.

### 6) Güncelleme (yeni zip ile)
1) `docker compose down`
2) Yeni zip'i aynı klasöre aç (üzerine yaz)
3) `docker compose up -d --build`


