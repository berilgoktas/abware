/*
 * YARDIMCI SCRIPT: Duplicate Ürün Kayıtlarını Temizleme
 * 
 * ⚠️⚠️⚠️  DİKKAT ⚠️⚠️⚠️
 * 
 * Bu script duplicate kayıtları SİLER!
 * Çalıştırmadan önce MUTLAKA veritabanı yedeği alın!
 * 
 * Strateji:
 * - Her duplicate grup için EN SON eklenen kaydı tutar
 * - Diğerlerini siler (eski kayıtlar)
 * - StokIslemleri gibi ilişkili tablolardaki referansları günceller
 * 
 * Bu script'i çalıştırarak, veritabanı yedeği aldığınızı
 * ve ne yaptığınızı anladığınızı kabul etmiş olursunuz.
 */

PRINT '';
PRINT '⚠️⚠️⚠️  DİKKAT  ⚠️⚠️⚠️';
PRINT 'Bu script DUPLICATE kayıtları SİLECEK!';
PRINT 'Devam etmek için 5 saniye bekleniyor...';
PRINT '';
WAITFOR DELAY '00:00:05'; -- 5 saniye bekle

BEGIN TRY
    BEGIN TRANSACTION;

    PRINT '========================================';
    PRINT 'Duplicate Ürün Kayıtları Temizleme';
    PRINT '========================================';
    PRINT '';

    /* 1) Duplicate kayıtları tespit et */
    PRINT '1. Duplicate kayıtlar tespit ediliyor...';
    
    IF OBJECT_ID('tempdb..#Duplicates') IS NOT NULL
        DROP TABLE #Duplicates;
    
    -- Her duplicate grup için en son eklenen kaydı TUTACAĞIZ, diğerlerini SİLECEĞİZ
    SELECT 
        u.Id,
        u.FirmaId,
        u.Barkod,
        u.UrunKodu,
        u.UrunAdi,
        u.OlusturmaTarihi,
        ROW_NUMBER() OVER (
            PARTITION BY u.FirmaId, u.Barkod 
            ORDER BY u.OlusturmaTarihi DESC, u.Id DESC
        ) as RowNum
    INTO #Duplicates
    FROM Urunler u
    WHERE EXISTS (
        SELECT 1
        FROM Urunler u2
        WHERE u2.FirmaId = u.FirmaId
          AND u2.Barkod = u.Barkod
          AND u2.Barkod IS NOT NULL 
          AND LTRIM(RTRIM(u2.Barkod)) <> ''
        GROUP BY u2.FirmaId, u2.Barkod
        HAVING COUNT(*) > 1
    );
    
    DECLARE @silinecek_count INT;
    SELECT @silinecek_count = COUNT(*) FROM #Duplicates WHERE RowNum > 1;
    
    IF @silinecek_count = 0
    BEGIN
        PRINT '   ✅ Duplicate kayıt bulunamadı. İşlem gerekmiyor.';
        COMMIT TRANSACTION;
        RETURN;
    END;
    
    PRINT '   ⚠️  ' + CAST(@silinecek_count AS NVARCHAR(10)) + ' adet kayıt silinecek!';
    PRINT '';

    /* 2) Silinecek kayıtları detaylı raporla */
    PRINT '2. Silinecek kayıtlar:';
    PRINT '   ' + REPLICATE('-', 80);
    
    DECLARE @report NVARCHAR(MAX) = '';
    SELECT @report = @report + 
        '   ID: ' + CAST(Id AS NVARCHAR(10)) + 
        ', Barkod: ' + Barkod + 
        ', Ürün: ' + UrunKodu + ' - ' + UrunAdi +
        ', Tarih: ' + CONVERT(NVARCHAR, OlusturmaTarihi, 120) + 
        CHAR(13) + CHAR(10)
    FROM #Duplicates
    WHERE RowNum > 1
    ORDER BY FirmaId, Barkod, OlusturmaTarihi;
    
    PRINT @report;
    PRINT '';

    /* 3) İlişkili tablolardaki referansları güncelle */
    PRINT '3. İlişkili tablolar kontrol ediliyor...';
    
    -- 3a) StokIslemleri tablosu
    IF OBJECT_ID('dbo.StokIslemleri', 'U') IS NOT NULL
    BEGIN
        DECLARE @stok_islem_count INT;
        SELECT @stok_islem_count = COUNT(*)
        FROM StokIslemleri si
        WHERE si.UrunId IN (SELECT Id FROM #Duplicates WHERE RowNum > 1);
        
        IF @stok_islem_count > 0
        BEGIN
            PRINT '   ⚠️  ' + CAST(@stok_islem_count AS NVARCHAR(10)) + ' adet StokIslemleri kaydı etkilenecek!';
            PRINT '   ℹ️  Bu kayıtlar en güncel ürün ID''sine bağlanacak.';
            
            -- Her duplicate grup için en güncel ürün ID'sini bul ve güncelle
            UPDATE si
            SET si.UrunId = (
                SELECT TOP 1 d.Id
                FROM #Duplicates d
                WHERE d.FirmaId = si.FirmaId
                  AND d.Barkod = (
                      SELECT u.Barkod 
                      FROM Urunler u 
                      WHERE u.Id = si.UrunId
                  )
                  AND d.RowNum = 1
                ORDER BY d.OlusturmaTarihi DESC
            )
            FROM StokIslemleri si
            WHERE si.UrunId IN (SELECT Id FROM #Duplicates WHERE RowNum > 1);
            
            PRINT '   ✅ StokIslemleri kayıtları güncellendi.';
        END
        ELSE
        BEGIN
            PRINT '   ℹ️  StokIslemleri: Etkilenen kayıt yok.';
        END;
    END;
    
    -- 3b) RafStok tablosu
    IF OBJECT_ID('dbo.RafStok', 'U') IS NOT NULL
    BEGIN
        DECLARE @raf_stok_count INT;
        SELECT @raf_stok_count = COUNT(*)
        FROM RafStok rs
        WHERE rs.UrunId IN (SELECT Id FROM #Duplicates WHERE RowNum > 1);
        
        IF @raf_stok_count > 0
        BEGIN
            PRINT '   ⚠️  ' + CAST(@raf_stok_count AS NVARCHAR(10)) + ' adet RafStok kaydı etkilenecek!';
            
            -- RafStok için merge stratejisi gerekebilir
            -- Burada basit bir güncelleme yapıyoruz ama manuel kontrol önerilir
            UPDATE rs
            SET rs.UrunId = (
                SELECT TOP 1 d.Id
                FROM #Duplicates d
                WHERE d.FirmaId = rs.FirmaId
                  AND d.Barkod = (
                      SELECT u.Barkod 
                      FROM Urunler u 
                      WHERE u.Id = rs.UrunId
                  )
                  AND d.RowNum = 1
                ORDER BY d.OlusturmaTarihi DESC
            )
            FROM RafStok rs
            WHERE rs.UrunId IN (SELECT Id FROM #Duplicates WHERE RowNum > 1);
            
            PRINT '   ✅ RafStok kayıtları güncellendi.';
        END
        ELSE
        BEGIN
            PRINT '   ℹ️  RafStok: Etkilenen kayıt yok.';
        END;
    END;
    
    -- 3c) IslemGecmisi tablosu
    IF OBJECT_ID('dbo.IslemGecmisi', 'U') IS NOT NULL
    BEGIN
        DECLARE @islem_gecmisi_count INT;
        SELECT @islem_gecmisi_count = COUNT(*)
        FROM IslemGecmisi ig
        WHERE ig.UrunId IN (SELECT Id FROM #Duplicates WHERE RowNum > 1);
        
        IF @islem_gecmisi_count > 0
        BEGIN
            PRINT '   ⚠️  ' + CAST(@islem_gecmisi_count AS NVARCHAR(10)) + ' adet IslemGecmisi kaydı etkilenecek!';
            
            UPDATE ig
            SET ig.UrunId = (
                SELECT TOP 1 d.Id
                FROM #Duplicates d
                WHERE d.FirmaId = ig.FirmaId
                  AND d.Barkod = (
                      SELECT u.Barkod 
                      FROM Urunler u 
                      WHERE u.Id = ig.UrunId
                  )
                  AND d.RowNum = 1
                ORDER BY d.OlusturmaTarihi DESC
            )
            FROM IslemGecmisi ig
            WHERE ig.UrunId IN (SELECT Id FROM #Duplicates WHERE RowNum > 1);
            
            PRINT '   ✅ IslemGecmisi kayıtları güncellendi.';
        END
        ELSE
        BEGIN
            PRINT '   ℹ️  IslemGecmisi: Etkilenen kayıt yok.';
        END;
    END;

    PRINT '';

    /* 4) Duplicate kayıtları sil */
    PRINT '4. Duplicate kayıtlar siliniyor...';
    
    DELETE FROM Urunler
    WHERE Id IN (SELECT Id FROM #Duplicates WHERE RowNum > 1);
    
    PRINT '   ✅ ' + CAST(@silinecek_count AS NVARCHAR(10)) + ' kayıt silindi.';
    PRINT '';

    /* 5) Doğrulama */
    PRINT '5. Doğrulama yapılıyor...';
    
    DECLARE @kalan_duplicate INT;
    SELECT @kalan_duplicate = COUNT(*)
    FROM (
        SELECT FirmaId, Barkod, COUNT(*) as Adet
        FROM Urunler
        WHERE Barkod IS NOT NULL AND LTRIM(RTRIM(Barkod)) <> ''
        GROUP BY FirmaId, Barkod
        HAVING COUNT(*) > 1
    ) x;
    
    IF @kalan_duplicate = 0
    BEGIN
        PRINT '   ✅ Tüm duplicate kayıtlar temizlendi!';
    END
    ELSE
    BEGIN
        PRINT '   ⚠️  UYARI: Hala ' + CAST(@kalan_duplicate AS NVARCHAR(10)) + ' duplicate grup var!';
        PRINT '   ℹ️  Script''i tekrar çalıştırmanız gerekebilir.';
    END;

    PRINT '';
    PRINT '========================================';
    PRINT '✅ Temizlik tamamlandı!';
    PRINT '========================================';
    PRINT '';
    PRINT 'Sonraki adım:';
    PRINT '  → 2025-15_urunler_barkod_unique_constraint.sql script''ini çalıştırın';
    PRINT '';

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION;
    
    DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
    DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
    DECLARE @ErrorState INT = ERROR_STATE();
    
    PRINT '';
    PRINT '========================================';
    PRINT '❌ HATA: Temizlik başarısız!';
    PRINT '========================================';
    PRINT 'Hata Mesajı: ' + @ErrorMessage;
    PRINT '';
    
    RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
END CATCH;
