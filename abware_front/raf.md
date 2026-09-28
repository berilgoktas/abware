# Raf Yonetimi – Mobil UI Tasarimi

Bu dokuman, depo yonetim sistemi icin tasarlanan **Raf Yonetimi mobil ekraninin** arayuz yapisini ve kullanici deneyimini aciklar.

---

## Genel Amac

Raf Yonetimi ekrani;
- Raflarin goruntulenmesi
- Raf ekleme, duzenleme ve silme islemleri
- Raf tiplerine gore hizli filtreleme

amaclariyla tasarlanmistir. Tasarim **mobile-first** yaklasimiyla, tek elle kullanima uygun sekilde planlanmistir.

---

## Ekran Bilesenleri

### 1. Header (Ust Alan)

- Sayfa basligi: **Raf Yonetimi**
- Sol tarafta geri donus ikonu
- Sag ustte **“+” (Yeni Raf Ekle)** butonu bulunur
- Header sabit (sticky) olacak sekilde tasarlanmistir

---

### 2. Arama Alani

Header altinda yer alan arama inputu:
- Placeholder: `Raf kodu / adi ara`
- RafAdi veya RafKodu uzerinden filtreleme yapar
- Kullanici yazdikca liste dinamik olarak guncellenir

---

### 3. Raf Tipi Sekmeleri (Tabs)

Arama alaninin altinda raf tiplerine gore sekmeler bulunur:

- Tum Raflar
- Normal
- Mal Kabul
- Cikis

Sekmeler sayesinde kullanici sadece istedigi raf tipini goruntuleyebilir. Mobil uyum icin yatay kaydirilabilir (scrollable) sekme yapisi tercih edilmistir.

---

### 4. Raf Kartlari (Card Yapisi)

Her raf, ayri bir **card** seklinde listelenir.

#### Kart Icerigi:
- **RafAdi** (kalin yazi)
- RafTipi (badge / chip olarak)
- RafKodu
- Aktiflik durumu (AKTIF / PASIF etiketi)

#### Butonlar:
- **Duzenle** (mavi / primary)
- **Sil** (kirmizi / danger)

Silme islemi oncesinde kullaniciya onay sorulmasi planlanmistir.

---

### 5. Renk ve Durum Gosterimleri

- **AKTIF** → Yesil badge
- **PASIF** → Gri badge
- **NORMAL Raf** → Gri / mavi tonlar
- **MAL KABUL** → Sari tonlar
- **CIKIS** → Kirmizi tonlar

Bu renkler depo ortaminda hizli algilama icin secilmistir.

---

### 6. Bos Durum (Empty State)

Eger secilen sekmede hic raf yoksa:
- Orta alanda bir kutu ikonu gosterilir
- “Henuz raf eklenmemis” mesaji yer alir
- Altinda **Yeni Raf Ekle** butonu bulunur

Bu sayede kullaniciya net bir yonlendirme saglanir.

---

## Kullanici Deneyimi (UX) Notlari

- Tek elle kullanima uygundur
- Butonlar buyuk ve net araliklarla konumlandirilmistir
- Yanlis silme islemlerini onlemek icin onay mekanizmasi dusunulmustur
- Modal / Bottom Sheet ile raf ekleme ve duzenleme akisi planlanmistir

---

## Teknik Notlar

-
- Card, Tab ve Modal yapilari component bazli gelistirilebilir
- API’den gelen `normal`, `mal_kabul`, `cikis`, `tum_raflar` alanlari dogrudan sekmelere baglanabilir

---

## Sonuc

Bu tasarim;
- Depo calisanlari
- Mal kabul personeli
- IT ve operasyon ekipleri

icin hizli, anlasilir ve guvenli bir raf yonetimi deneyimi sunmayi hedefler.
