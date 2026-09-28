# Duplicate Ürün Kaydı Sorunu - Çözüm

## Sorun Nedir?

Frontend'de art arda butona basılarak aynı barkodda birden fazla ürün eklenebildiği tespit edildi. Bu bir **race condition** sorunudur:

```
İstek 1: Kontrol → Ürün yok → Ekle
İstek 2: Kontrol → Ürün yok → Ekle (İstek 1 henüz ekleme yapmadan)
Sonuç: Aynı barkodda 2 ürün oluştu! ❌
```

### Neden Oldu?

- ✅ API seviyesinde kontrol var AMA
- ❌ Veritabanı seviyesinde **UNIQUE constraint** yok
- ❌ Bu yüzden race condition durumunda API kontrolü işe yaramıyor

## Çözüm

Veritabanı seviyesinde **UNIQUE INDEX** ekleyeceğiz. Böylece:
- Aynı firma içinde aynı barkodda 2. ürün **veritabanı tarafından reddedilecek**
- Race condition olsa bile duplicate kayıt oluşmayacak

---

## Adım Adım Uygulama

### Adım 1: Mevcut Durumu Kontrol Et

```sql
-- Duplicate barkod var mı kontrol et
SELECT 
    FirmaId,
    Barkod,
    COUNT(*) as Adet,
    STRING_AGG(CAST(Id AS NVARCHAR(MAX)), ', ') AS UrunIDler
FROM Urunler
WHERE Barkod IS NOT NULL AND LTRIM(RTRIM(Barkod)) <> ''
GROUP BY FirmaId, Barkod
HAVING COUNT(*) > 1
ORDER BY Adet DESC;
```

**Sonuç boşsa:** Adım 3'e geç  
**Sonuç varsa:** Adım 2'ye devam et

---

### Adım 2: Duplicate Kayıtları Temizle (Opsiyonel)

⚠️ **DİKKAT:** Bu adım kayıt silecek! Mutlaka backup alın!

#### 2a) Duplicate kayıtları detaylı incele

```sql
-- Her duplicate kaydın detaylarını gör
SELECT 
    u.*,
    f.Ad as FirmaAdi,
    -- Kaç adet stok işlemi var?
    (SELECT COUNT(*) FROM StokIslemleri WHERE UrunId = u.Id) as StokIslemSayisi
FROM Urunler u
INNER JOIN Firmalar f ON u.FirmaId = f.Id
WHERE u.Barkod IN (
    SELECT Barkod
    FROM Urunler
    WHERE Barkod IS NOT NULL AND LTRIM(RTRIM(Barkod)) <> ''
    GROUP BY FirmaId, Barkod
    HAVING COUNT(*) > 1
)
ORDER BY u.FirmaId, u.Barkod, u.OlusturmaTarihi;
```

#### 2b) Temizlik script'ini çalıştır

1. **Veritabanı yedeği alın!** ⚠️
2. `2025-15_TEMIZLIK_duplicate_urunler.sql` dosyasını açın
3. Dosyanın başındaki güvenlik kilidini kaldırın:
   ```sql
   -- Bu satırı yorumdan çıkarın:
   DECLARE @ONAY BIT = 1;
   ```
4. Script'i çalıştırın

**Ne yapar?**
- En son eklenen kaydı tutar
- Eski kayıtları siler
- İlişkili tablolardaki referansları günceller (StokIslemleri, RafStok, IslemGecmisi)

---

### Adım 3: Unique Constraint Ekle

`2025-15_urunler_barkod_unique_constraint.sql` dosyasını çalıştırın.

**Bu script:**
1. Duplicate kontrol yapar (varsa HATA verir ve durdurur)
2. Yoksa UNIQUE INDEX ekler:
   - `UX_Urunler_FirmaId_Barkod`
   - `UX_Urunler_FirmaId_UrunKodu` (bonus)

---

### Adım 4: Doğrulama

```sql
-- Unique index'lerin eklendiğini doğrula
SELECT 
    i.name AS IndexName,
    c.name AS ColumnName,
    i.is_unique AS IsUnique
FROM sys.indexes i
INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
WHERE i.object_id = OBJECT_ID('dbo.Urunler')
  AND i.name LIKE 'UX_%'
ORDER BY i.name, ic.key_ordinal;
```

Beklenen sonuç:
```
IndexName                       ColumnName    IsUnique
-------------------------------- ------------ ---------
UX_Urunler_FirmaId_Barkod       FirmaId      1
UX_Urunler_FirmaId_Barkod       Barkod       1
UX_Urunler_FirmaId_UrunKodu     FirmaId      1
UX_Urunler_FirmaId_UrunKodu     UrunKodu     1
```

---

### Adım 5: Test Et

Aynı barkodla 2. kez ürün eklemeyi deneyin:

**Beklenen sonuç:**
- API: `"Bu ürün kodu veya barkod zaten kullanılıyor"` hatası
- Eğer API kontrolü bypass edilirse (race condition):
  - Veritabanı: **Unique constraint violation** hatası
  - İkinci kayıt **kesinlikle eklenmez** ✅

---

## API Davranışı

Migration sonrası API'de değişiklik gerekmez ama şunu bilmelisiniz:

### Şu anki kod (products.py):

```python
# Kontrol yapar ama race condition'a karşı korumasız
check_sql = """
    SELECT COUNT(*) AS Sayi FROM Urunler
    WHERE FirmaId = ? AND (UrunKodu = ? OR Barkod = ?)
"""
```

### Migration sonrası:

```python
# Aynı kontrol devam eder
# AMA veritabanı seviyesinde de koruma var
# Race condition olsa bile veritabanı 2. kaydı reddeder
```

**Önerilen iyileştirme (opsiyonel):**

API'de hata mesajını iyileştirin. Unique constraint violation yakalandığında kullanıcı dostu mesaj gösterin:

```python
try:
    # INSERT işlemi
    pass
except pyodbc.IntegrityError as e:
    if "UX_Urunler_FirmaId_Barkod" in str(e):
        return error_response(
            "DUPLICATE_PRODUCT",
            "Bu barkod zaten kullanılıyor (veritabanı koruması)",
            400
        )
    elif "UX_Urunler_FirmaId_UrunKodu" in str(e):
        return error_response(
            "DUPLICATE_PRODUCT",
            "Bu ürün kodu zaten kullanılıyor (veritabanı koruması)",
            400
        )
    raise
```

---

## Özet

| Özellik | Öncesi | Sonrası |
|---------|--------|---------|
| API kontrolü | ✅ Var | ✅ Var |
| DB constraint | ❌ Yok | ✅ Var |
| Race condition koruması | ❌ Yok | ✅ Var |
| Aynı barkod ekleme | ⚠️ Mümkün | ❌ İmkansız |

---

## Sorular?

### Frontend düzeltmesi gerekli mi?

Hayır. Ama şu iyileştirmeleri yapabilirsiniz:
- Button disable etme (butona basıldığında devre dışı bırak)
- Debounce/throttle ekle (hızlı tıklamaları engelle)
- Loading state göster

### Bu migration geri alınabilir mi?

Evet, unique index'i silebilirsiniz:

```sql
DROP INDEX UX_Urunler_FirmaId_Barkod ON dbo.Urunler;
DROP INDEX UX_Urunler_FirmaId_UrunKodu ON dbo.Urunler;
```

**Ancak geri almayın!** Bu constraint sisteminizi korur.

### Performans etkisi var mı?

- ✅ Minimal etki (zaten index'li sorgular)
- ✅ Insert biraz yavaşlar (microsaniye seviyesinde)
- ✅ Duplicate kontrol sorguları DAHA HIZLI olur

---

## Git Commit Önerisi

Migration'ı commit ederken:

```bash
git add db/2025-15_urunler_barkod_unique_constraint.sql
git add db/2025-15_TEMIZLIK_duplicate_urunler.sql
git add db/README_DUPLICATE_FIX.md

git commit -m "fix(db): Race condition nedeniyle duplicate ürün eklenmesi engellendi

- Urunler tablosuna FirmaId+Barkod için unique index eklendi
- Urunler tablosuna FirmaId+UrunKodu için unique index eklendi
- Veritabanı seviyesinde duplicate kayıt koruması sağlandı
- Mevcut duplicate kayıtları temizlemek için yardımcı script eklendi

Closes #[issue-number]"
```
