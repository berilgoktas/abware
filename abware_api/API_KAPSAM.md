# ABWare API Kapsam Dokümantasyonu

## 1. Genel API Bilgileri

### Temel Bilgiler
- **Base URL:** `https://abware.arnesit.com/api` (production) / `http://localhost:5000/api` (development)
- **API Versiyonu:** v1
- **Veri Formatı:** JSON
- **Kimlik Doğrulama:** JWT (JSON Web Token)
- **Karakter Kodlaması:** UTF-8
- **Çoklu Firma Desteği:** Tüm veriler firma bazlıdır. Kullanıcı login olurken girdiği `firma_kodu` üzerinden sadece kendi firmasının verilerini görebilir.

### HTTP Metodları
- `GET` - Veri okuma
- `POST` - Yeni kayıt oluşturma
- `PUT` - Kayıt güncelleme
- `DELETE` - Kayıt silme

### Response Formatı

**Başarılı Response:**
```json
{
  "success": true,
  "data": { ... },
  "message": "İşlem başarılı"
}
```

**Hata Response:**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Hata mesajı",
    "details": { ... }
  }
}
```

### Kimlik Doğrulama
Tüm endpoint'ler (login hariç) JWT token gerektirir. Token, request header'ında şu şekilde gönderilmelidir:
```
Authorization: Bearer <token>
```

---

## 2. Swagger Dokümantasyonu Kullanımı

### Swagger UI'a Erişim
Swagger UI, API dokümantasyonunu görselleştirmek ve test etmek için kullanılır.

**URL:** `GET /api/docs`

**Önemli:** Swagger UI'a erişim için önce login yapmanız gerekmektedir.

### Login İşlemi
1. Swagger UI açıldığında, sayfanın üst kısmında bir login formu görünecektir
2. `/api/auth/login` endpoint'ini kullanarak giriş yapın
3. Response'da dönen `token` değerini kopyalayın

### Token Kullanımı
1. Swagger UI'da sağ üst köşedeki **"Authorize"** butonuna tıklayın
2. Açılan modal'da `Bearer` yazısının yanına boşluk bırakarak token'ınızı yapıştırın
   - Örnek: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
3. **"Authorize"** butonuna tıklayın
4. **"Close"** ile modal'ı kapatın

### Endpoint Test Etme
1. Swagger UI'da test etmek istediğiniz endpoint'i bulun
2. Endpoint'in yanındaki **"Try it out"** butonuna tıklayın
3. Gerekli parametreleri ve request body'yi doldurun
4. **"Execute"** butonuna tıklayın
5. Response'u inceleyin

### Swagger Özellikleri
- **Detaylı Açıklamalar:** Her endpoint için işlev açıklaması, parametre açıklamaları ve örnekler
- **Request/Response Örnekleri:** Gerçekçi örnek request ve response'lar
- **Yetki Gereksinimleri:** Her endpoint için hangi rollerin erişebileceği belirtilmiştir
- **Hata Senaryoları:** Olası hata kodları ve anlamları
- **Canlı Test:** Endpoint'leri doğrudan Swagger UI üzerinden test edebilirsiniz

---

## 3. Kimlik Doğrulama Endpoint'leri

### POST /api/auth/login
Kullanıcı girişi yapar ve JWT token döner.

**Yetki Gereksinimi:** Yok (herkes erişebilir)

**Request Body:**
```json
{
  "firma_kodu": "string (zorunlu, örn: DENEME)",
  "kullanici_adi": "string (zorunlu)",
  "sifre": "string (zorunlu)"
}
```

**Örnek Request:**
```json
{
  "firma_kodu": "DENEME",
  "kullanici_adi": "admin",
  "sifre": "sifre123"
}
```

**Başarılı Response (200):**
```json
{
  "success": true,
  "data": {
    "firma_id": 1,
    "kullanici_adi": "admin",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_type": "Bearer",
    "expires_in": 86400,
    "kullanici": {
      "id": 1,
      "firma_id": 1,
      "firma_kodu": "DENEME",
      "firma_adi": "Deneme Firma",
      "kullanici_adi": "admin",
      "ad_soyad": "Admin Kullanıcı",
      "email": "admin@abware.com",
      "aktif": true,
      "is_super_admin": true,
      "rol": {
        "id": 1,
        "ad": "Admin",
        "aciklama": "Sistem yöneticisi - Tüm yetkilere sahip"
      }
    }
  },
  "message": "Giriş başarılı"
}
```

**Hata Response (401):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Kullanıcı adı veya şifre hatalı"
  }
}
```

**Hata Response (400):**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Firma kodu, kullanıcı adı ve şifre zorunludur"
  }
}
```

---

### POST /api/auth/logout
Kullanıcı çıkışı yapar ve token'ı geçersiz kılar.

**Yetki Gereksinimi:** Kimlik doğrulama gerekli

**Request Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Çıkış başarılı"
}
```

---

### POST /api/auth/refresh
JWT token'ı yeniler.

**Yetki Gereksinimi:** Geçerli refresh token gerekli

**Request Body:**
```json
{
  "refresh_token": "string (zorunlu)"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_type": "Bearer",
    "expires_in": 86400
  }
}
```

---

### GET /api/auth/me (kaldırıldı)
Mevcut kullanıcı bilgilerini döner.

**Yetki Gereksinimi:** Kimlik doğrulama gerekli

**Request Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "kullanici_adi": "admin",
    "ad_soyad": "Admin Kullanıcı",
    "email": "admin@abware.com",
    "aktif": true,
    "rol": {
      "id": 1,
      "ad": "Admin",
      "aciklama": "Sistem yöneticisi"
    },
    "olusturma_tarihi": "2024-01-15T10:30:00Z"
  }
}
```

---

## 4. Dashboard Endpoint'leri

### GET /api/dashboard/stats
Dashboard için genel istatistikleri döner.

**Yetki Gereksinimi:** Admin veya Depo Sorumlusu

**Request Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "toplam_urun": 1250,
    "kritik_stok_sayisi": 15,
    "bugun_giris": 45,
    "bugun_cikis": 32,
    "toplam_stok_degeri": 1250000.50
  }
}
```

**Kullanım Senaryosu:** Dashboard sayfası açıldığında bu endpoint çağrılarak genel istatistikler gösterilir.

---

### GET /api/dashboard/critical-stocks
Kritik stok seviyesinin altında olan ürünleri listeler.

**Yetki Gereksinimi:** Admin veya Depo Sorumlusu

**Query Parameters:**
- `limit` (opsiyonel, default: 20): Döndürülecek kayıt sayısı
- `offset` (opsiyonel, default: 0): Sayfalama için offset

**Response (200):**
```json
{
  "success": true,
  "data": {
    "urunler": [
      {
        "id": 5,
        "urun_kodu": "UR001",
        "urun_adi": "Örnek Ürün",
        "reel_stok": 5,
        "kritik_stok": 10,
        "durum": "kritik"
      }
    ],
    "toplam": 15,
    "limit": 20,
    "offset": 0
  }
}
```

---

### GET /api/dashboard/recent-activities
Son yapılan işlemleri listeler.

**Yetki Gereksinimi:** Admin veya Depo Sorumlusu

**Query Parameters:**
- `limit` (opsiyonel, default: 10): Döndürülecek kayıt sayısı

**Response (200):**
```json
{
  "success": true,
  "data": {
    "aktiviteler": [
      {
        "id": 100,
        "islem_tipi": "stok_giris",
        "aciklama": "Ürün girişi yapıldı",
        "kullanici": {
          "id": 2,
          "ad_soyad": "Depo Personeli"
        },
        "urun": {
          "id": 5,
          "urun_kodu": "UR001",
          "urun_adi": "Örnek Ürün"
        },
        "miktar": 50,
        "tarih": "2024-01-15T14:30:00Z"
      }
    ],
    "toplam": 10
  }
}
```

---

### GET /api/dashboard/today-transactions
Bugünkü giriş/çıkış istatistiklerini döner.

**Yetki Gereksinimi:** Admin veya Depo Sorumlusu

**Response (200):**
```json
{
  "success": true,
  "data": {
    "bugun": "2024-01-15",
    "giris": {
      "adet": 45,
      "toplam_miktar": 1250,
      "urun_sayisi": 12
    },
    "cikis": {
      "adet": 32,
      "toplam_miktar": 850,
      "urun_sayisi": 8
    }
  }
}
```

---

## 5. Ürün Yönetimi Endpoint'leri

### GET /api/products
Ürün listesini döner. Filtreleme, arama ve sayfalama desteği vardır.

**Yetki Gereksinimi:** Tüm roller (filtreleme farklılıkları olabilir)

**Query Parameters:**
- `limit` (opsiyonel, default: 100): Kaç kayıt gelsin? (max: 5000)
- `arama` (opsiyonel): Ürün kodu, adı veya barkod üzerinde arama
- `kritik_stok` (opsiyonel, boolean): Sadece kritik stokta olan ürünleri getir
- `siralama` (opsiyonel, default: "urun_adi"): Sıralama alanı (urun_adi, urun_kodu, reel_stok)
- `yön` (opsiyonel, default: "asc"): Sıralama yönü (asc, desc)

**Örnek Request:**
```
GET /api/products?sayfa=1&limit=20&arama=UR001&kritik_stok=true
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "urunler": [
      {
        "id": 1,
        "urun_kodu": "UR001",
        "urun_adi": "Örnek Ürün 1",
        "barkod": "1234567890123",
        "aciklama": "Ürün açıklaması",
        "kritik_stok": 10,
        "reel_stok": 25,
        "toplam_giris": 100,
        "toplam_cikis": 75,
        "olusturma_tarihi": "2024-01-10T10:00:00Z",
        "guncelleme_tarihi": "2024-01-15T14:30:00Z"
      }
    ],
    "sayfalama": {
      "limit": 100,
      "donen": 100
    }
  }
}
```

**Kullanım Senaryosu:** Ürün listesi sayfasında tüm ürünler listelenir, kullanıcı arama ve filtreleme yapabilir.

---

### GET /api/products/:id
Belirli bir ürünün detay bilgilerini döner.

**Yetki Gereksinimi:** Tüm roller

**Path Parameters:**
- `id` (zorunlu): Ürün ID'si

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "urun_kodu": "UR001",
    "urun_adi": "Örnek Ürün 1",
    "barkod": "1234567890123",
    "aciklama": "Ürün açıklaması",
    "kritik_stok": 10,
    "reel_stok": 25,
    "toplam_giris": 100,
    "toplam_cikis": 75,
    "olusturma_tarihi": "2024-01-10T10:00:00Z",
    "guncelleme_tarihi": "2024-01-15T14:30:00Z"
  }
}
```

**Hata Response (404):**
```json
{
  "success": false,
  "error": {
    "code": "PRODUCT_NOT_FOUND",
    "message": "Ürün bulunamadı"
  }
}
```

---

### POST /api/products
Yeni ürün ekler.

**Yetki Gereksinimi:** Admin

**Request Body:**
```json
{
  "urun_kodu": "string (zorunlu, benzersiz)",
  "urun_adi": "string (zorunlu)",
  "barkod": "string (zorunlu, benzersiz)",
  "kritik_stok": "integer (zorunlu, >= 0)",
  "adet_turu": "string (opsiyonel, serbest metin. Örn: adet, koli, paket, kg)",
  "aciklama": "string (opsiyonel)"
}
```

**Örnek Request:**
```json
{
  "urun_kodu": "UR002",
  "urun_adi": "Yeni Ürün",
  "barkod": "9876543210987",
  "kritik_stok": 15,
  "adet_turu": "koli",
  "aciklama": "Yeni eklenen ürün açıklaması"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": 2,
    "urun_kodu": "UR002",
    "urun_adi": "Yeni Ürün",
    "barkod": "9876543210987",
    "kritik_stok": 15,
    "aciklama": "Yeni eklenen ürün açıklaması",
    "reel_stok": 0,
    "toplam_giris": 0,
    "toplam_cikis": 0,
    "olusturma_tarihi": "2024-01-15T15:00:00Z"
  },
  "message": "Ürün başarıyla eklendi"
}
```

**Hata Response (400):**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Ürün kodu zorunludur"
  }
}
```

**Hata Response (409):**
```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_PRODUCT",
    "message": "Bu ürün kodu veya barkod zaten kullanılıyor"
  }
}
```

---

### PUT /api/products/:id
Mevcut ürünü günceller.

**Yetki Gereksinimi:** Admin

**Path Parameters:**
- `id` (zorunlu): Ürün ID'si

**Request Body:**
```json
{
  "urun_adi": "string (opsiyonel)",
  "barkod": "string (opsiyonel, benzersiz olmalı)",
  "kritik_stok": "integer (opsiyonel, >= 0)",
  "adet_turu": "string (opsiyonel, serbest metin. Örn: adet, koli, paket, kg)",
  "aciklama": "string (opsiyonel)"
}
```

**Not:** `urun_kodu` güncellenemez.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "urun_kodu": "UR001",
    "urun_adi": "Güncellenmiş Ürün Adı",
    "barkod": "1234567890123",
    "kritik_stok": 20,
    "aciklama": "Güncellenmiş açıklama",
    "guncelleme_tarihi": "2024-01-15T16:00:00Z"
  },
  "message": "Ürün başarıyla güncellendi"
}
```

---

### DELETE /api/products/:id
Ürünü siler.

**Yetki Gereksinimi:** Admin

**Path Parameters:**
- `id` (zorunlu): Ürün ID'si

**Response (200):**
```json
{
  "success": true,
  "message": "Ürün başarıyla silindi"
}
```

**Hata Response (400):**
```json
{
  "success": false,
  "error": {
    "code": "PRODUCT_HAS_TRANSACTIONS",
    "message": "Bu ürüne ait işlem kayıtları olduğu için silinemez"
  }
}
```

---

### GET /api/products/:id/transactions
Belirli bir ürünün işlem geçmişini döner.

**Yetki Gereksinimi:** Tüm roller

**Path Parameters:**
- `id` (zorunlu): Ürün ID'si

**Query Parameters:**
- `sayfa` (opsiyonel, default: 1): Sayfa numarası
- `limit` (opsiyonel, default: 20): Sayfa başına kayıt sayısı
- `baslangic_tarihi` (opsiyonel): Başlangıç tarihi (YYYY-MM-DD)
- `bitis_tarihi` (opsiyonel): Bitiş tarihi (YYYY-MM-DD)
- `islem_tipi` (opsiyonel): İşlem tipi (giris, cikis)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "urun": {
      "id": 1,
      "urun_kodu": "UR001",
      "urun_adi": "Örnek Ürün 1"
    },
    "islemler": [
      {
        "id": 50,
        "islem_tipi": "giris",
        "miktar": 100,
        "aciklama": "Stok girişi",
        "kullanici": {
          "id": 2,
          "ad_soyad": "Depo Personeli"
        },
        "tarih": "2024-01-15T10:00:00Z"
      }
    ],
    "sayfalama": {
      "sayfa": 1,
      "limit": 20,
      "toplam_kayit": 45,
      "toplam_sayfa": 3
    }
  }
}
```

---

## 6. Stok İşlemleri Endpoint'leri

### POST /api/transactions/entry
Stok girişi yapar.

**Yetki Gereksinimi:** Tüm roller

**Request Body:**
```json
{
  "barkod": "string (zorunlu) veya urun_id (zorunlu)",
  "miktar": "integer (zorunlu, > 0)",
  "aciklama": "string (opsiyonel)"
}
```

**Örnek Request (Barkod ile):**
```json
{
  "barkod": "1234567890123",
  "miktar": 50,
  "aciklama": "Tedarikçiden gelen ürün"
}
```

**Örnek Request (Ürün ID ile):**
```json
{
  "urun_id": 1,
  "miktar": 50,
  "aciklama": "Tedarikçiden gelen ürün"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": 100,
    "islem_tipi": "giris",
    "urun": {
      "id": 1,
      "urun_kodu": "UR001",
      "urun_adi": "Örnek Ürün 1"
    },
    "miktar": 50,
    "onceki_stok": 25,
    "yeni_stok": 75,
    "aciklama": "Tedarikçiden gelen ürün",
    "kullanici": {
      "id": 2,
      "ad_soyad": "Depo Personeli"
    },
    "tarih": "2024-01-15T15:30:00Z"
  },
  "message": "Stok girişi başarıyla yapıldı"
}
```

**Hata Response (404):**
```json
{
  "success": false,
  "error": {
    "code": "PRODUCT_NOT_FOUND",
    "message": "Barkod ile eşleşen ürün bulunamadı"
  }
}
```

**Kullanım Senaryosu:** Depo personeli barkod okutur veya ürün seçer, miktar girer ve stok girişi yapar.

---

### POST /api/transactions/exit
Stok çıkışı yapar.

**Yetki Gereksinimi:** Tüm roller

**Request Body:**
```json
{
  "barkod": "string (zorunlu) veya urun_id (zorunlu)",
  "miktar": "integer (zorunlu, > 0)",
  "aciklama": "string (opsiyonel)"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": 101,
    "islem_tipi": "cikis",
    "urun": {
      "id": 1,
      "urun_kodu": "UR001",
      "urun_adi": "Örnek Ürün 1"
    },
    "miktar": 20,
    "onceki_stok": 75,
    "yeni_stok": 55,
    "aciklama": "Satış için çıkış",
    "kullanici": {
      "id": 2,
      "ad_soyad": "Depo Personeli"
    },
    "tarih": "2024-01-15T16:00:00Z"
  },
  "message": "Stok çıkışı başarıyla yapıldı"
}
```

**Hata Response (400):**
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Yetersiz stok. Mevcut stok: 55, İstenen: 60"
  }
}
```

---

### GET /api/transactions
Stok işlemlerini listeler.

**Yetki Gereksinimi:** Tüm roller

**Query Parameters:**
- `limit` (opsiyonel, default: 100): Kaç kayıt gelsin? (max: 5000)
- `baslangic_tarihi` (opsiyonel): Başlangıç tarihi (YYYY-MM-DD)
- `bitis_tarihi` (opsiyonel): Bitiş tarihi (YYYY-MM-DD)
- `islem_tipi` (opsiyonel): İşlem tipi (giris, cikis)
- `urun_id` (opsiyonel): Belirli bir ürünün işlemleri
- `kullanici_id` (opsiyonel): Belirli bir kullanıcının işlemleri

**Response (200):**
```json
{
  "success": true,
  "data": {
    "islemler": [
      {
        "id": 100,
        "islem_tipi": "giris",
        "urun": {
          "id": 1,
          "urun_kodu": "UR001",
          "urun_adi": "Örnek Ürün 1"
        },
        "miktar": 50,
        "aciklama": "Tedarikçiden gelen ürün",
        "kullanici": {
          "id": 2,
          "ad_soyad": "Depo Personeli"
        },
        "tarih": "2024-01-15T15:30:00Z"
      }
    ],
    "sayfalama": {
      "limit": 100,
      "donen": 100
    }
  }
}
```

---

## 7. Kullanıcı Yönetimi Endpoint'leri

### GET /api/users
Kullanıcı listesini döner.

**Yetki Gereksinimi:** Admin

**Query Parameters:**
- `limit` (opsiyonel, default: 100): Kaç kayıt gelsin? (max: 5000)
- `arama` (opsiyonel): Kullanıcı adı veya ad soyad üzerinde arama
- `rol_id` (opsiyonel): Belirli bir role göre filtreleme
- `aktif` (opsiyonel, boolean): Sadece aktif/pasif kullanıcıları getir

**Response (200):**
```json
{
  "success": true,
  "data": {
    "kullanicilar": [
      {
        "id": 1,
        "kullanici_adi": "admin",
        "ad_soyad": "Admin Kullanıcı",
        "email": "admin@abware.com",
        "aktif": true,
        "rol": {
          "id": 1,
          "ad": "Admin"
        },
        "olusturma_tarihi": "2024-01-10T10:00:00Z"
      }
    ],
    "sayfalama": {
      "limit": 100,
      "donen": 15
    }
  }
}
```

---

### POST /api/users
Yeni kullanıcı ekler.

**Yetki Gereksinimi:** Admin

**Request Body:**
```json
{
  "kullanici_adi": "string (zorunlu, benzersiz)",
  "sifre": "string (zorunlu, min 6 karakter)",
  "ad_soyad": "string (zorunlu)",
  "email": "string (opsiyonel, geçerli email formatı)",
  "rol_id": "integer (zorunlu, 1=Admin, 2=Depo Sorumlusu, 3=Depo Personeli)",
  "aktif": "boolean (opsiyonel, default: true)"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": 5,
    "kullanici_adi": "yeni_kullanici",
    "ad_soyad": "Yeni Kullanıcı",
    "email": "yeni@abware.com",
    "aktif": true,
    "rol": {
      "id": 2,
      "ad": "Depo Sorumlusu"
    },
    "olusturma_tarihi": "2024-01-15T17:00:00Z"
  },
  "message": "Kullanıcı başarıyla eklendi"
}
```

---

### PUT /api/users/:id
Kullanıcı bilgilerini günceller.

**Yetki Gereksinimi:** Admin

**Path Parameters:**
- `id` (zorunlu): Kullanıcı ID'si

**Request Body:**
```json
{
  "ad_soyad": "string (opsiyonel)",
  "email": "string (opsiyonel)",
  "sifre": "string (opsiyonel, min 6 karakter)",
  "aktif": "boolean (opsiyonel)"
}
```

**Not:** `kullanici_adi` ve `rol_id` güncellenemez. Rol güncelleme için ayrı endpoint kullanılır.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 5,
    "kullanici_adi": "yeni_kullanici",
    "ad_soyad": "Güncellenmiş Ad Soyad",
    "email": "guncel@abware.com",
    "aktif": true,
    "guncelleme_tarihi": "2024-01-15T17:30:00Z"
  },
  "message": "Kullanıcı başarıyla güncellendi"
}
```

---

### DELETE /api/users/:id
Kullanıcıyı siler.

**Yetki Gereksinimi:** Admin

**Path Parameters:**
- `id` (zorunlu): Kullanıcı ID'si

**Response (200):**
```json
{
  "success": true,
  "message": "Kullanıcı başarıyla silindi"
}
```

**Hata Response (400):**
```json
{
  "success": false,
  "error": {
    "code": "CANNOT_DELETE_SELF",
    "message": "Kendi hesabınızı silemezsiniz"
  }
}
```

---

### PUT /api/users/:id/roles
Kullanıcının rolünü günceller.

**Yetki Gereksinimi:** Admin

**Path Parameters:**
- `id` (zorunlu): Kullanıcı ID'si

**Request Body:**
```json
{
  "rol_id": "integer (zorunlu, 1=Admin, 2=Depo Sorumlusu, 3=Depo Personeli)"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 5,
    "kullanici_adi": "yeni_kullanici",
    "rol": {
      "id": 3,
      "ad": "Depo Personeli"
    }
  },
  "message": "Kullanıcı rolü başarıyla güncellendi"
}
```

---

### PUT /api/users/:id/status
Kullanıcının aktif/pasif durumunu günceller.

**Yetki Gereksinimi:** Admin

**Path Parameters:**
- `id` (zorunlu): Kullanıcı ID'si

**Request Body:**
```json
{
  "aktif": "boolean (zorunlu)"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 5,
    "kullanici_adi": "yeni_kullanici",
    "aktif": false
  },
  "message": "Kullanıcı durumu başarıyla güncellendi"
}
```

---

## 8. Raporlama Endpoint'leri (Gelecek için)

Bu endpoint'ler gelecekte eklenecektir. Şu an için sadece planlama aşamasındadır.

### GET /api/reports/stock-movement
Stok hareket raporu.

**Yetki Gereksinimi:** Admin veya Depo Sorumlusu

**Planlanan Özellikler:**
- Tarih aralığına göre stok hareketleri
- Ürün bazlı filtreleme
- Giriş/çıkış ayrımı
- Excel/PDF export

---

### GET /api/reports/critical-stock
Kritik stok raporu.

**Yetki Gereksinimi:** Admin veya Depo Sorumlusu

**Planlanan Özellikler:**
- Kritik stok seviyesinin altındaki ürünler
- Stok seviyesi analizi
- Excel/PDF export

---

## 9. Hata Kodları ve Mesajları

### Genel Hata Kodları

| HTTP Status | Hata Kodu | Açıklama |
|------------|-----------|----------|
| 400 | VALIDATION_ERROR | Geçersiz veya eksik parametre |
| 400 | INSUFFICIENT_STOCK | Yetersiz stok |
| 400 | CANNOT_DELETE_SELF | Kendi hesabınızı silemezsiniz |
| 400 | PRODUCT_HAS_TRANSACTIONS | Ürüne ait işlem kayıtları var |
| 401 | UNAUTHORIZED | Kimlik doğrulama gerekli |
| 401 | INVALID_CREDENTIALS | Kullanıcı adı veya şifre hatalı |
| 401 | TOKEN_EXPIRED | Token süresi dolmuş |
| 401 | INVALID_TOKEN | Geçersiz token |
| 403 | FORBIDDEN | Yetkiniz yok |
| 404 | NOT_FOUND | Kayıt bulunamadı |
| 404 | PRODUCT_NOT_FOUND | Ürün bulunamadı |
| 404 | USER_NOT_FOUND | Kullanıcı bulunamadı |
| 409 | DUPLICATE_PRODUCT | Ürün kodu veya barkod zaten kullanılıyor |
| 409 | DUPLICATE_USERNAME | Kullanıcı adı zaten kullanılıyor |
| 500 | INTERNAL_SERVER_ERROR | Sunucu hatası |

### Hata Response Formatı
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Kullanıcı dostu hata mesajı",
    "details": {
      "field": "Hangi alanda hata var",
      "reason": "Detaylı hata açıklaması"
    }
  }
}
```

---

## 10. Yetki Matrisi Tablosu

| Endpoint | Admin | Depo Sorumlusu | Depo Personeli |
|----------|-------|----------------|----------------|
| **Kimlik Doğrulama** |
| POST /api/auth/login | ✅ | ✅ | ✅ |
| POST /api/auth/logout | ✅ | ✅ | ✅ |
| POST /api/auth/refresh | ✅ | ✅ | ✅ |
| GET /api/auth/me | ❌ | ❌ | ❌ |
| **Dashboard** |
| GET /api/dashboard/stats | ✅ | ✅ | ❌ |
| GET /api/dashboard/critical-stocks | ✅ | ✅ | ❌ |
| GET /api/dashboard/recent-activities | ✅ | ✅ | ❌ |
| GET /api/dashboard/today-transactions | ✅ | ✅ | ❌ |
| **Ürün Yönetimi** |
| GET /api/products | ✅ | ✅ | ✅ |
| GET /api/products/:id | ✅ | ✅ | ✅ |
| POST /api/products | ✅ | ❌ | ❌ |
| PUT /api/products/:id | ✅ | ❌ | ❌ |
| DELETE /api/products/:id | ✅ | ❌ | ❌ |
| GET /api/products/:id/transactions | ✅ | ✅ | ✅ |
| **Stok İşlemleri** |
| POST /api/transactions/entry | ✅ | ✅ | ✅ |
| POST /api/transactions/exit | ✅ | ✅ | ✅ |
| GET /api/transactions | ✅ | ✅ | ✅ |
| **Kullanıcı Yönetimi** |
| GET /api/users | ✅ | ❌ | ❌ |
| POST /api/users | ✅ | ❌ | ❌ |
| PUT /api/users/:id | ✅ | ❌ | ❌ |
| DELETE /api/users/:id | ✅ | ❌ | ❌ |
| PUT /api/users/:id/roles | ✅ | ❌ | ❌ |
| PUT /api/users/:id/status | ✅ | ❌ | ❌ |
| **Raporlama** |
| GET /api/reports/* | ✅ | ✅ | ❌ |
| **Swagger** |
| GET /api/docs | ✅ | ✅ | ✅ |
| GET /api/swagger.json | ✅ | ✅ | ✅ |

### Yetki Açıklamaları

**Admin:**
- Tüm işlemlere erişim
- Kullanıcı yönetimi
- Ürün ekleme/silme
- Raporlama

**Depo Sorumlusu:**
- Dashboard erişimi
- Ürün görüntüleme
- Stok giriş/çıkış
- Raporlama
- Kritik stok düzenleme (⚠️ tüm ürünler için)

**Depo Personeli:**
- Ürün görüntüleme
- Stok giriş/çıkış
- Yeni ürün ekleyemez (kayıtlı olmayan ürünler için)

---

## Ek Notlar

### Rate Limiting
Gelecekte rate limiting eklenecektir. Şu an için sınır yoktur.

### Pagination
Listeleme endpoint'lerinde varsayılan limit 100'dür. Maksimum limit 5000 olarak ayarlanmıştır.

### Tarih Formatı
Tüm tarih alanları ISO 8601 formatında (UTC) döner: `YYYY-MM-DDTHH:mm:ssZ`

### Barkod Okuma
Barkod okuma işlemi manuel giriş olarak yapılacaktır. Barkod okuyucu cihazlar veya kamera ile okuma özellikleri gelecekte eklenebilir.

### Güvenlik
- Tüm şifreler hash'lenerek saklanır (bcrypt)
- JWT token'lar 24 saat geçerlidir
- Refresh token'lar 30 gün geçerlidir
- HTTPS kullanımı zorunludur (production)

