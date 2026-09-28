# ABWare Test Ortam Değişkenleri (Örnek)

Bu testler **entegrasyon testidir**: gerçek SQL Server’a bağlanır ve gerçek endpoint’leri çağırır.

## 1) Login bilgileri (zorunlu)

Testler, login için şu environment variable’ları bekler:

- `ABWARE_TEST_FIRMA_KODU`
- `ABWARE_TEST_KULLANICI_ADI`
- `ABWARE_TEST_SIFRE`

Windows PowerShell örneği:

```powershell
$env:ABWARE_TEST_FIRMA_KODU="DENEME"
$env:ABWARE_TEST_KULLANICI_ADI="admin"
$env:ABWARE_TEST_SIFRE="admin123"
```

## 2) DB bağlantısı (zorunlu)

Uygulama `ABWare-Backend/.env` üzerinden DB bilgilerini okur.

Örnek `.env`:

```env
DB_SERVER=localhost,1433
DB_DATABASE=ABWareDB
DB_USERNAME=sa
DB_PASSWORD=your_password
DB_DRIVER=ODBC Driver 18 for SQL Server
DB_ENCRYPT=yes
DB_TRUST_CERT=yes

JWT_SECRET_KEY=dev-secret-key-change-in-production
FLASK_ENV=development
```

## 3) Testleri çalıştırma

```powershell
cd ABWare-Backend
python -m pytest
```


