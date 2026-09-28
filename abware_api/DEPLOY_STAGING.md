## ABWare Backend - Staging Ortamı Kurulumu

Staging ortamı, production'dan bağımsız olarak yeni özellikleri test etmek için kullanılır.

### Özellikler
- ✅ Production'dan bağımsız çalışır
- ✅ Farklı port (varsayılan: 5050)
- ✅ Test veritabanı kullanır (ABWareDB_Test)
- ✅ Swagger UI açık (geliştirme kolaylığı için)
- ✅ Debug modu aktif

### 1) Staging Environment Dosyası Oluştur

```powershell
# env.staging.example dosyasını kopyalayıp env.staging oluştur
Copy-Item env.staging.example env.staging
```

`env.staging` dosyasını düzenleyin:
- `DB_SERVER`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` değerlerini kontrol edin
- Test veritabanı kullanıldığından emin olun (`DB_DATABASE=ABWareDB_Test`)
- `CORS_ORIGINS` içine frontend geliştirme URL'lerini ekleyin

### 2) Staging Ortamını Başlat

```powershell
# Staging ortamını başlat
docker compose -f docker-compose.staging.yml up -d --build
```

### 3) Port Kontrolü

Staging ortamı varsayılan olarak **port 5051**'de çalışır (5049 ve 5000'de eski kod çalışıyor).

- Lokal erişim: `http://localhost:5051`
- Swagger UI: `http://localhost:5051/api/docs`
- Login sayfası: `http://localhost:5051/swagger-login`

Port'u değiştirmek için `env.staging` dosyasına ekleyin:
```
STAGING_PORT=5051
```

### 4) Log Kontrolü

```powershell
# Staging loglarını görüntüle
docker compose -f docker-compose.staging.yml logs -f

# Sadece son 100 satır
docker compose -f docker-compose.staging.yml logs --tail=100
```

### 5) Durdurma ve Yeniden Başlatma

```powershell
# Durdur
docker compose -f docker-compose.staging.yml down

# Yeniden başlat
docker compose -f docker-compose.staging.yml up -d

# Yeniden build ile başlat
docker compose -f docker-compose.staging.yml up -d --build
```

### 6) Production vs Staging Karşılaştırması

| Özellik | Production | Staging |
|---------|-----------|---------|
| Port | 5049, 5000 (eski kod) | 5051 (yeni kod) |
| Veritabanı | ABWareDB | ABWareDB_Test |
| Swagger UI | Kapalı | Açık |
| Debug | Kapalı | Açık |
| Container Adı | abware-backend | abware-backend-staging |
| Compose Dosyası | docker-compose.yml | docker-compose.staging.yml |
| Env Dosyası | .env | env.staging |

### 7) Cloudflare Tunnel ile Yayınlama (Opsiyonel)

Eğer staging'i dışarıdan erişilebilir yapmak isterseniz:

1. Cloudflare Tunnel'da yeni bir route ekleyin:
   - Domain: `staging-webservis.abware.com.tr` (veya istediğiniz subdomain)
   - Target: `http://localhost:5050`

2. `env.staging` dosyasında `CORS_ORIGINS`'e staging domain'ini ekleyin:
   ```
   CORS_ORIGINS=https://staging-webservis.abware.com.tr,http://localhost:3000,http://localhost:5173
   ```

### 8) Frontend Geliştirme

Frontend geliştirirken staging backend'i kullanmak için:

```javascript
// Frontend .env dosyası
VITE_API_URL=http://localhost:5050/api
// veya
REACT_APP_API_URL=http://localhost:5050/api
```

### 9) Güncelleme

Staging ortamını güncellemek için:

```powershell
# Durdur
docker compose -f docker-compose.staging.yml down

# Yeni kodu çek (git pull) veya dosyaları güncelle

# Yeniden build ve başlat
docker compose -f docker-compose.staging.yml up -d --build
```

### 10) Sorun Giderme

**Port çakışması:**
```powershell
# Hangi portlar kullanılıyor kontrol et
netstat -ano | findstr :5050
netstat -ano | findstr :5049
```

**Container çalışmıyor:**
```powershell
# Container durumunu kontrol et
docker compose -f docker-compose.staging.yml ps

# Container loglarını kontrol et
docker compose -f docker-compose.staging.yml logs
```

**Veritabanı bağlantı hatası:**
- `env.staging` dosyasındaki DB ayarlarını kontrol edin
- Test veritabanının (`ABWareDB_Test`) mevcut olduğundan emin olun
- ODBC Driver'ın doğru olduğunu kontrol edin (17 veya 18)
