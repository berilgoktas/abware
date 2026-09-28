# ABWare Backend Kullanım Kitapçığı

## 1) Genel Akış

- **Login** → JWT token alırsın
- Sonraki tüm isteklerde **Authorization: Bearer `<token>`**
- Firma bağlamı artık **header’dan değil**, **token içindeki `firma_id` claim’inden** gelir

### Base URL'ler

| Ortam | URL | Port | Swagger |
|-------|-----|------|---------|
| **Production** | `https://webservis.abware.com.tr/api` | 5049 | Kapalı |
| **Local Production** | `http://localhost:5049/api` | 5049 | Opsiyonel |
| **Staging/Test** | `http://localhost:5051/api` | 5051 | Açık |

**Swagger UI:**
- Production: `http://localhost:5049/api/` (SWAGGER_ENABLED=True ise)
- Staging: `http://localhost:5051/api/` (Her zaman açık)

## 2) Login

### Endpoint
- `POST /api/auth/login`

### İstek

```json
{
  "firma_kodu": "DENEME",
  "kullanici_adi": "admin",
  "sifre": "admin123"
}
```

### Cevap (özet)
- `data.token`: access token
- `data.refresh_token`: refresh token
- `data.firma_id`: firma id (top-level)
- `data.kullanici_adi`: kullanıcı adı (top-level)
- `data.kullanici.firma_id`: firma id (nested)
- `data.kullanici.roller`: kullanıcının roller listesi (yeni model)

## 3) Token ile örnek çağrı

### Not
`/api/auth/me` endpoint'i kaldırıldı. Kullanıcı bilgisi için login response içindeki `data.kullanici` alanını kullan.

## 4) Kontrol Paneli (Dashboard)

- `GET /api/dashboard/stats`
  - toplam ürün adedi (aktif)
  - kritik stok (aktif ürünlerde ReelStok <= KritikStok)
  - bugünkü giriş/çıkış adetleri
- `GET /api/dashboard/recent-activities?period=daily&limit=10`
  - period: `daily|monthly|yearly`
- `GET /api/dashboard/critical-stocks`
- `GET /api/dashboard/today-transactions`

## 5) Ürün Yönetimi

### Ürün listesi
- `GET /api/products`
- Query: `aktif=1|0|all` (default: `all`)
- Basit limit: `?limit=1000` (max: 5000) -> ilk N kayıt döner

### Ürün ekleme (Rol: Ürün Ekle)
- `POST /api/products`

Alanlar:
- `urun_kodu` (zorunlu)
- `urun_adi` (zorunlu)
- `barkod` (zorunlu)
- `kritik_stok` (zorunlu)
- `fiyat_tl` (opsiyonel, TL birim fiyatı). Gönderilirse sistem o günün EUR kuru ile `FiyatEUR` hesaplayıp kaydeder.
- `adet_turu` (opsiyonel, serbest metin. Örn: adet, koli, paket, kg)
- `aciklama` (opsiyonel)
- `aktif` (opsiyonel, default true)

### Ürün durum (pasife alma/aktif etme)
- `PUT /api/products/<id>/status`

```json
{ "aktif": false }
```

### Barkod ile ürün+stok öğrenme
- `GET /api/products/lookup?barkod=...`

## 6) Stok İşlemleri

### Birleşik stok hareketi
- `POST /api/transactions/move`

```json
{
  "barkod": "1234567890123",
  "yon": "giris",
  "miktar": 10,
  "aciklama": "Tedarikçi teslimatı"
}
```

`yon`: `giris|cikis`

### Mevcut uyumluluk endpoint’leri (opsiyonel)
- `POST /api/transactions/entry`
- `POST /api/transactions/exit`
- `GET /api/transactions` (sayfalama: `?sayfa=1&limit=100`)
- `GET /api/transactions` (limit: `?limit=1000`)

Not: Stok hareketi sırasında, ürünün `FiyatEUR` değeri ve o günün EUR kuru ile `BirimFiyatTL` otomatik hesaplanıp `StokIslemleri` kaydına yazılır.

## 7) Kullanıcı Yönetimi (Rol: Kullanıcı Yönetimi)

### Roller listesi
- `GET /api/users/roles` (sadece token yeterli)

### Liste
- `GET /api/users` (limit: `?limit=1000`)

### Kullanıcı oluşturma
- `POST /api/users`

```json
{
  "kullanici_adi": "personel1",
  "sifre": "123456",
  "ad_soyad": "Depo Personeli 1",
  "email": "p1@example.com",
  "rol_ids": [3],
  "aktif": true
}
```

### Kullanıcı güncelleme
- `PUT /api/users/<id>`

Örnek (kullanıcıya rol atama/değiştirme):

```json
{
  "rol_ids": [1, 2]
}
```

### Kullanıcı pasife alma
- `PUT /api/users/<id>/status`

```json
{ "aktif": false }
```

## 8) Otomatik Testleri Çalıştırma

Testler `pytest` ile yazılmıştır ve gerçek DB’ye bağlanır.

1) DB bağlantısı için `ABWare-Backend/.env` dosyan hazır olmalı.\n
2) Login bilgilerini env ile ver:

```powershell
cd ABWare-Backend
$env:ABWARE_TEST_FIRMA_KODU="DENEME"
$env:ABWARE_TEST_KULLANICI_ADI="admin"
$env:ABWARE_TEST_SIFRE="admin123"
python -m pytest
```

## 9) Logout / Refresh ne işe yarar?

### Logout
- `POST /api/auth/logout`
- Token yapısı stateless olduğu için backend tarafında “token iptali” yapılmaz (blacklist yok).
- Pratikte logout: istemci tarafında token’ı silmektir.

### Refresh
- `POST /api/auth/refresh` (refresh token ile yeni access token üretir)
- Normal kullanım: `Authorization: Bearer <refresh_token>` ile çağırırsın.
- Uyumluluk: bazı istemciler refresh token’ı body’de gönderir. Bunun için:
  - `POST /api/auth/refresh-body` body: `{ "refresh_token": "<token>" }`


