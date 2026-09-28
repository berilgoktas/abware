# 📦 ABWare Backend

Modern depo ve stok yönetim sistemi için Python Flask tabanlı REST API.

[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.0+-green.svg)](https://flask.palletsprojects.com/)
[![SQL Server](https://img.shields.io/badge/SQL%20Server-2019+-red.svg)](https://www.microsoft.com/sql-server)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)

---

## 🎯 Özellikler

### 📊 Stok Yönetimi
- Gerçek zamanlı stok takibi (Giriş/Çıkış/Transfer)
- Kritik stok uyarıları
- Barkod bazlı işlemler
- Raf sistemi ile lokasyon takibi

### 🏢 Raf Sistemi (V2)
- **Mal Kabul Rafları:** Gelen ürünler için geçici alan
- **Normal Raflar:** Ana depolama alanları
- **Çıkış Rafları:** Sevkiyat öncesi hazırlık alanı
- Raf bazlı stok hareketleri ve transfer

### 👥 Kullanıcı Yönetimi
- Rol bazlı yetkilendirme (RBAC)
- JWT token authentication
- Firma bazlı veri izolasyonu
- Çoklu kullanıcı desteği

### 📈 Dashboard & Raporlama
- Gerçek zamanlı istatistikler
- Kritik stok listesi
- Günlük işlem özeti
- Excel export desteği

### 💰 Fiyat Yönetimi
- TL ve EUR dual currency
- Otomatik kur çevrimi (Frankfurter API)
- Stok hareket bazlı maliyet takibi

### 🔒 Güvenlik
- Bcrypt şifre hashleme
- JWT access & refresh tokens
- SQL injection koruması
- CORS yapılandırması

---

## 🚀 Hızlı Başlangıç (Docker)

### Gereksinimler
- Docker Desktop
- SQL Server (host veya container)
- Git

### 1. Projeyi Klonla

```bash
git clone https://github.com/aytacmelihkilic/ABWARE-BACKEND.git
cd ABWARE-BACKEND
```

### 2. Ortam Değişkenlerini Ayarla

```bash
# Production için
cp env.example .env

# Staging/Test için
cp env.staging.example env.staging
```

`.env` dosyasını düzenle:
```env
DB_SERVER=10.0.0.4,1433
DB_DATABASE=ABWareDB
DB_USERNAME=sa
DB_PASSWORD=YourPassword123
JWT_SECRET_KEY=change-this-to-random-string
```

### 3. Docker ile Başlat

**Production (Port 5049):**
```bash
docker-compose up -d --build
```

**Staging/Test (Port 5051):**
```bash
docker-compose -f docker-compose.staging.yml up -d --build
```

### 4. API'ye Erişim

| Ortam | URL | Swagger UI |
|-------|-----|------------|
| **Production** | http://localhost:5049/api | http://localhost:5049/api/ |
| **Staging** | http://localhost:5051/api | http://localhost:5051/api/ |

---

## 📋 Manuel Kurulum (Development)

### 1. Gereksinimler

- Python 3.8+
- Microsoft SQL Server 2019+
- ODBC Driver 18 for SQL Server

### 2. Sanal Ortam Oluştur

```bash
python -m venv venv

# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate
```

### 3. Bağımlılıkları Yükle

```bash
pip install -r requirements.txt
```

### 4. Veritabanını Hazırla

`db/` klasöründeki migration dosyalarını sırayla çalıştır:
```sql
-- SQL Server Management Studio'da
db/2025-01_raf_sistemi.sql
db/2025-12_fiyat_kur_pagination.sql
db/2025-13_stok_islemleri_aciklama.sql
db/2025-14_stok_islemleri_islem_tipi_transfer.sql
db/2025-15_urunler_barkod_unique_constraint.sql
```

### 5. Uygulamayı Başlat

```bash
python app.py
```

Uygulama `http://localhost:5000` adresinde çalışır.

---

## 🐳 Docker Detaylı Kullanım

### Port Yapılandırması

| Ortam | Docker Port | Host Port | Veritabanı |
|-------|-------------|-----------|------------|
| Production | 5000 | 5049 | ABWareDB |
| Staging | 5000 | 5051 | ABWareDB_Test |

### İki Ortamı Birlikte Çalıştırma

```bash
# Production'ı başlat
docker-compose up -d

# Staging'i başlat
docker-compose -f docker-compose.staging.yml up -d

# Container'ları kontrol et
docker ps

# Logları izle
docker-compose logs -f                              # Production
docker-compose -f docker-compose.staging.yml logs -f  # Staging
```

### Container Yönetimi

```bash
# Durdur
docker-compose down

# Yeniden başlat
docker-compose restart

# Temizlik (volume'ler dahil)
docker-compose down -v

# Container içine gir
docker-compose exec abware-backend bash
```

---

## 📚 API Dokümantasyonu

### Base URL'ler

| Ortam | URL |
|-------|-----|
| Production | `https://webservis.abware.com.tr/api` |
| Local Production | `http://localhost:5049/api` |
| Staging/Test | `http://localhost:5051/api` |

### Ana Endpoint'ler

#### 🔐 Kimlik Doğrulama
```http
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/refresh
```

#### 📦 Ürün Yönetimi
```http
GET    /api/products              # Liste
POST   /api/products              # Yeni ürün
GET    /api/products/:id          # Detay
PUT    /api/products/:id          # Güncelle
PUT    /api/products/:id/status   # Aktif/Pasif
GET    /api/products/lookup?barkod=XXX  # Barkod ile ara
```

#### 📊 Stok İşlemleri

**Basit İşlemler:**
```http
POST /api/transactions/entry      # Basit giriş
POST /api/transactions/exit       # Basit çıkış
POST /api/transactions/move       # Birleşik (giriş/çıkış)
```

**Raf Bazlı İşlemler (V2):**
```http
POST /api/transactions/entry-v2    # Raf bazlı giriş
POST /api/transactions/exit-v2     # Raf bazlı çıkış
POST /api/transactions/transfer-v2 # Raf arası transfer
```

#### 🏢 Raf Yönetimi
```http
GET    /api/raflar                 # Liste
POST   /api/raflar                 # Yeni raf
GET    /api/raflar/:id             # Detay
PUT    /api/raflar/:id             # Güncelle
DELETE /api/raflar/:id             # Sil
GET    /api/raflar/:id/stok        # Raf stok durumu
GET    /api/raflar/:id/hareketler  # Raf hareketleri
```

#### 📈 Dashboard
```http
GET /api/dashboard/stats
GET /api/dashboard/critical-stocks
GET /api/dashboard/recent-activities
GET /api/dashboard/today-transactions
```

#### 📑 Raporlar
```http
GET /api/reports/stok-durum-raporu          # Genel stok raporu
GET /api/reports/stok-durum-raporu-excel    # Excel export
GET /api/reports/raf-stok-raporu            # Raf bazlı rapor
GET /api/reports/raf-stok-raporu-excel      # Excel export
```

**Detaylı API dokümantasyonu:** [KITAPCIK.md](KITAPCIK.md) ve [API_KAPSAM.md](API_KAPSAM.md)

---

## 🏗️ Raf Sistemi İş Kuralları

### Giriş İşlemi (entry-v2)

**Akış:**
1. Ürün önce **MAL_KABUL** rafına girilir
2. Hedef raf belirtilmezse → Mal kabule atılır
3. Hedef raf belirtilirse → Mal kabul → Hedef rafa otomatik transfer
4. ❌ Hedef raf **ÇIKIŞ RAFI** olamaz

**Örnek:**
```json
{
  "barkod": "1234567890",
  "adet": 50,
  "giris_rafi_barkodu": "MAL-KABUL-01",
  "hedef_raf_barkodu": "A-01-05"  // Opsiyonel
}
```

### Çıkış İşlemi (exit-v2)

**Akış:**
1. Ürün kaynak raftan (NORMAL raf) alınır
2. **CIKIS** rafına atılır
3. Çıkış rafında bekler (otomatik çıkarılmaz)
4. ReelStok azaltılır
5. ❌ Kaynak raf **MAL_KABUL** olamaz

**Örnek:**
```json
{
  "kaynak_raf_barkodu": "A-01-05",
  "barkod": "1234567890",
  "adet": 20,
  "cikis_rafi_barkodu": "CIKIS-01"  // Birden fazla varsa zorunlu
}
```

### Transfer İşlemi (transfer-v2)

**Akış:**
1. Herhangi bir raftan → Herhangi bir rafa
2. ❌ Hedef raf **ÇIKIŞ RAFI** olamaz (sadece exit-v2 ile)

**Örnek:**
```json
{
  "kaynak_raf_barkodu": "MAL-KABUL-01",
  "hedef_raf_barkodu": "A-01-05",
  "barkod": "1234567890",
  "adet": 30
}
```

---

## 🗂️ Proje Yapısı

```
ABWare-Backend/
├── 📄 app.py                      # Ana uygulama
├── 📄 config.py                   # Yapılandırma
├── 📄 database.py                 # DB bağlantısı
├── 📄 requirements.txt            # Python bağımlılıkları
│
├── 📁 routes/                     # API Endpoint'leri
│   ├── auth.py                   # Kimlik doğrulama
│   ├── companies.py              # Firma yönetimi
│   ├── dashboard.py              # Dashboard
│   ├── products.py               # Ürün yönetimi
│   ├── raflar.py                 # Raf yönetimi
│   ├── reports.py                # Raporlama
│   ├── transactions.py           # Stok işlemleri
│   └── users.py                  # Kullanıcı yönetimi
│
├── 📁 middleware/                 # Middleware'ler
│   └── auth.py                   # Yetkilendirme
│
├── 📁 utils/                      # Yardımcı fonksiyonlar
│   ├── audit.py                  # İşlem loglama
│   ├── excel_reports.py          # Excel export
│   ├── fx.py                     # Kur çevrimi
│   ├── pagination.py             # Sayfalama
│   ├── password.py               # Şifre işlemleri
│   ├── raf.py                    # Raf helper'ları
│   └── responses.py              # Response formatları
│
├── 📁 db/                         # Database migrations
│   ├── 2025-01_raf_sistemi.sql
│   ├── 2025-12_fiyat_kur_pagination.sql
│   ├── 2025-13_stok_islemleri_aciklama.sql
│   ├── 2025-14_stok_islemleri_islem_tipi_transfer.sql
│   └── 2025-15_urunler_barkod_unique_constraint.sql
│
├── 📁 templates/                  # Swagger UI templates
├── 📁 static/                     # Static dosyalar
├── 📁 tests/                      # Test dosyaları
│
├── 🐳 Dockerfile                  # Docker image
├── 🐳 docker-compose.yml          # Production
├── 🐳 docker-compose.staging.yml # Staging/Test
├── 📄 .env.example                # Production env örneği
└── 📄 env.staging.example         # Staging env örneği
```

---

## 🔧 Geliştirme

### Test Kullanıcıları

Varsayılan test veritabanında (ABWareDB_Test):

| Kullanıcı Adı | Şifre | Rol | Firma |
|---------------|-------|-----|-------|
| admin | admin123 | Admin | TEST |

**⚠️ Production'da bu şifreleri mutlaka değiştirin!**

### Yeni Kullanıcı Şifresi Hash'leme

```python
from utils.password import hash_password

hashed = hash_password('yeni_sifre')
print(hashed)
```

### Test Veritabanı Kurulumu

```bash
python setup_test_db.py
```

Bu script:
- Rolleri production'dan kopyalar
- Test firması oluşturur
- Test kullanıcısı oluşturur (admin/admin123)
- Tüm rolleri kullanıcıya atar

---

## 🚨 Sorun Giderme

### Veritabanı Bağlantı Hatası

**Sorun:** `Login failed for user 'sa'`

**Çözüm:**
1. SQL Server çalışıyor mu kontrol et
2. `.env` dosyasındaki şifreyi kontrol et
3. SQL Server Authentication açık mı kontrol et
4. Firewall ayarlarını kontrol et

```bash
# SQL Server durumunu kontrol et (Windows)
Get-Service MSSQLSERVER
```

### Port Zaten Kullanılıyor

**Sorun:** `Bind for 0.0.0.0:5049 failed: port is already allocated`

**Çözüm:**
```bash
# Hangi process kullanıyor?
netstat -ano | findstr :5049

# Eski container'ı durdur
docker-compose down
```

### ODBC Driver Bulunamadı

**Sorun:** `Data source name not found`

**Çözüm:**
```bash
# Windows
# ODBC Driver 18 for SQL Server indir ve yükle
# https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server

# Linux (Ubuntu/Debian)
curl https://packages.microsoft.com/keys/microsoft.asc | apt-key add -
curl https://packages.microsoft.com/config/ubuntu/$(lsb_release -rs)/prod.list > /etc/apt/sources.list.d/mssql-release.list
apt-get update
ACCEPT_EULA=Y apt-get install -y msodbcsql18
```

### Import Hatası

**Sorun:** `ModuleNotFoundError`

**Çözüm:**
```bash
pip install -r requirements.txt --upgrade
```

### Migration Hatası

**Sorun:** Unique constraint ihlali

**Çözüm:** Duplicate kayıtları temizle
```bash
# db/README_DUPLICATE_FIX.md dosyasına bak
# db/2025-15_TEMIZLIK_duplicate_urunler.sql scriptini çalıştır
```

---

## 📖 Ek Dokümantasyon

- [KITAPCIK.md](KITAPCIK.md) - Detaylı API kullanım kılavuzu
- [API_KAPSAM.md](API_KAPSAM.md) - API kapsamı ve endpoint listesi
- [DEPLOY_DOCKER.md](DEPLOY_DOCKER.md) - Docker deployment rehberi
- [DEPLOY_STAGING.md](DEPLOY_STAGING.md) - Staging ortamı kurulum
- [db/README_DUPLICATE_FIX.md](db/README_DUPLICATE_FIX.md) - Duplicate kayıt temizleme

---

## 🤝 Katkıda Bulunma

### Git Workflow

```bash
# 1. Projeyi fork'la ve clone'la
git clone https://github.com/YOUR_USERNAME/ABWARE-BACKEND.git

# 2. Yeni branch oluştur
git checkout -b feature/yeni-ozellik

# 3. Değişiklikleri yap ve commit et
git add .
git commit -m "feat: Yeni özellik eklendi"

# 4. Push et
git push origin feature/yeni-ozellik

# 5. Pull Request oluştur
```

### Commit Message Formatı

```
feat: Yeni özellik eklendi
fix: Bug düzeltildi
docs: Dokümantasyon güncellendi
refactor: Kod yeniden düzenlendi
test: Test eklendi/güncellendi
chore: Bakım işlemleri
```

---

## 📝 Değişiklik Geçmişi

### v1.5.0 (2026-02-11)
- ✨ Transfer işleminde çıkış rafına atım engellendi
- ✨ Raf sistemi iş kuralları iyileştirildi
- 🐛 Çıkış işleminde otomatik çıkarma kaldırıldı

### v1.4.0 (2026-02-05)
- ✨ Duplicate ürün kaydı engellendi (race condition fix)
- ✨ Unique constraint eklendi (Barkod + UrunKodu)
- 📝 Staging ortamı dokümantasyonu eklendi

### v1.3.0 (2026-01-20)
- ✨ Raf sistemi eklendi (MAL_KABUL, CIKIS, NORMAL)
- ✨ Raf bazlı stok işlemleri (entry-v2, exit-v2, transfer-v2)
- ✨ Raf raporlama endpoint'leri

### v1.2.0 (2025-12-15)
- ✨ Dual currency desteği (TL/EUR)
- ✨ Otomatik kur çevrimi
- ✨ Excel export desteği

---

## 📄 Lisans

© 2024-2026 ABWare - Aytaç Beril Ware

Bu proje özel kullanım içindir. Ticari kullanım için izin gereklidir.

---

## 📞 İletişim

- **Geliştirici:** Aytaç Melih Kılıç
- **GitHub:** [aytacmelihkilic](https://github.com/aytacmelihkilic)
- **Production:** https://webservis.abware.com.tr

---

<div align="center">

**[⬆ Başa Dön](#-abware-backend)**

Made with ❤️ by ABWare Team

</div>
