# ABWare

ABWare, depo operasyonunu tek yerden yönetmek için yazılmış bir stok ve raf takip sistemidir. Bu Git deposu hem web arayüzünü (`abware_front`) hem REST API’yi (`abware_api`) içerir.

## Neden yapıldı?

Depoda asıl soru “elde kaç adet var?” değildir. Asıl sorular şunlardır:

- Ürün **hangi rafta** duruyor?
- Mal kabulden rafa, raftan sevkiyata **nasıl** gitti?
- Stok bitmeden **kim** uyarıldı?
- Bu işlemi **kim**, **hangi firma** adına yaptı?

Kağıt, Excel veya dağınık kayıtlarla bu cevaplar gecikir; yanlış rafa koyma, görünmeyen stok ve yetkisiz işlem doğar. ABWare bu boşluğu kapatmak için yapıldı: barkodla hızlı işlem, raf bazlı konum, rol bazlı yetki ve firma bazlı veri ayrımı.

## Hangi sorunu çözer?

| Sorun | Sistemdeki karşılık |
|--------|---------------------|
| Eldeki stok ile raftaki stok uyuşmaz | Ürün kartı + raf stoku birlikte tutulur |
| Gelen mal doğrudan rafa karışır | Önce mal kabul, sonra hedef rafa transfer |
| Sevkiyat hazırlığı belirsizdir | Çıkış / sevkiyat rafı |
| Kritik ürün fark edilmez | Kritik stok listesi ve dashboard |
| Herkes her işlemi yapabilir | Roller (ürün ekleme, stok, rapor, kullanıcı yönetimi…) |
| Birden fazla firma aynı ortamı kullanır | Firma koduna göre veri izolasyonu |
| Fiyat TL/EUR karışır | Ürün ve hareket üzerinde kur bilgisi |

## Proje ne yapar?

Kullanıcı firma kodu ile giriş yapar. Yetkisine göre:

- ürün tanımlar (kod, barkod, birim, fiyat)
- stok girişi, çıkışı ve raf transferi yapar
- rafları (mal kabul, normal, çıkış) yönetir
- anlık stok, bugünkü hareket ve raporları görür

Teknik olarak frontend React (Vite), backend Flask + SQL Server’dır. Docker ile ikisi birlikte ayağa kalkar; tarayıcı `/api` üzerinden yerel API’ye gider.

## Proje yapısı

```
abware/
├── abware_api/      Flask REST API
├── abware_front/    React (Vite) arayüz
└── docker-compose.yml
```

## Gereksinimler

- Docker Desktop **veya** Python 3.8+ / Node.js 20+
- Microsoft SQL Server
- ODBC Driver 18 for SQL Server (yerel API çalıştırırken)

## Hızlı başlangıç (Docker)

1. API ortam dosyasını oluştur:

```powershell
copy abware_api\env.example abware_api\.env
```

2. `.env` içinde SQL Server ve `JWT_SECRET_KEY` değerlerini doldur.

3. Çalıştır:

```powershell
docker compose up --build
```

Uygulama: [http://localhost:8080](http://localhost:8080)

Nginx `/api` isteklerini backend konteynerine iletir. SQL Server, konteynerden erişilebilir olmalıdır.

## Yerel geliştirme

### Backend

```powershell
cd abware_api
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
copy env.example .env
python app.py
```

API: [http://127.0.0.1:5000](http://127.0.0.1:5000)  
Swagger: [http://127.0.0.1:5000/api](http://127.0.0.1:5000/api)

### Frontend

```powershell
cd abware_front
npm install
npm run dev
```

Arayüz: [http://localhost:5173](http://localhost:5173)

Geliştirme sunucusu `/api` isteklerini `http://127.0.0.1:5000` adresine yönlendirir.

## Ortam değişkenleri

Hassas bilgiler Git’e girmez. Örnek dosyalar:

- `abware_api/env.example`
- `abware_api/env.staging.example`

`.env` dosyasını bu örneklerden kopyalayıp kendi sunucu ve şifrelerinle doldur.

## Demo giriş (test veritabanı)

| Alan | Değer |
|------|--------|
| Firma | `TEST` |
| Kullanıcı | `admin` |
| Şifre | `admin123` |

Bu bilgiler yalnızca test ortamı içindir. Canlı ortamda değiştirin.

## Daha fazla doküman

- [API kapsamı](abware_api/API_KAPSAM.md)
- [Docker deploy](abware_api/DEPLOY_DOCKER.md)
