/*
 * Migration: Ürünler tablosuna Barkod için Unique Constraint ekleme
 * 
 * Amaç: Race condition nedeniyle oluşan duplicate barkod kayıtlarını önlemek
 * 
 * Adımlar:
 * 1. Mevcut duplicate kayıtları tespit et ve raporla
 * 2. Duplicate kayıtları temizle (opsiyonel - manuel kontrol gerekebilir)
 * 3. Unique constraint ekle (FirmaId + Barkod)
 */

BEGIN TRY
    BEGIN TRANSACTION;

    PRINT '========================================';
    PRINT 'Ürünler Barkod Unique Constraint Ekleme';
    PRINT '========================================';

    /* 1) Mevcut duplicate kayıtları tespit et ve raporla */
    PRINT '';
    PRINT '1. Duplicate barkod kayıtları kontrol ediliyor...';
    
    IF OBJECT_ID('tempdb..#DuplicateBarkodlar') IS NOT NULL
        DROP TABLE #DuplicateBarkodlar;
    
    SELECT 
        FirmaId,
        Barkod,
        COUNT(*) as Adet,
        STRING_AGG(CAST(Id AS NVARCHAR(MAX)), ', ') AS UrunIDler
    INTO #DuplicateBarkodlar
    FROM Urunler
    WHERE Barkod IS NOT NULL AND LTRIM(RTRIM(Barkod)) <> ''
    GROUP BY FirmaId, Barkod
    HAVING COUNT(*) > 1;
    
    DECLARE @duplicate_count INT;
    SELECT @duplicate_count = COUNT(*) FROM #DuplicateBarkodlar;
    
    IF @duplicate_count > 0
    BEGIN
        PRINT '   ⚠️  UYARI: ' + CAST(@duplicate_count AS NVARCHAR(10)) + ' adet duplicate barkod grubu bulundu!';
        PRINT '';
        PRINT '   Duplicate Kayıtlar:';
        PRINT '   -------------------';
        
        DECLARE @report NVARCHAR(MAX) = '';
        SELECT @report = @report + 
            '   Firma: ' + CAST(FirmaId AS NVARCHAR(10)) + 
            ', Barkod: ' + Barkod + 
            ', Adet: ' + CAST(Adet AS NVARCHAR(10)) + 
            ', Ürün IDler: ' + UrunIDler + CHAR(13) + CHAR(10)
        FROM #DuplicateBarkodlar
        ORDER BY Adet DESC, FirmaId, Barkod;
        
        PRINT @report;
        PRINT '';
        PRINT '   ℹ️  Bu kayıtları manuel olarak kontrol etmeniz önerilir.';
        PRINT '   ℹ️  Aşağıdaki sorgu ile detaylı inceleme yapabilirsiniz:';
        PRINT '';
        PRINT '   SELECT u.*, f.Ad as FirmaAdi';
        PRINT '   FROM Urunler u';
        PRINT '   INNER JOIN Firmalar f ON u.FirmaId = f.Id';
        PRINT '   WHERE u.Barkod IN (';
        PRINT '       SELECT Barkod FROM (';
        PRINT '           SELECT Barkod, FirmaId, COUNT(*) as Adet';
        PRINT '           FROM Urunler';
        PRINT '           WHERE Barkod IS NOT NULL AND LTRIM(RTRIM(Barkod)) <> ''''';
        PRINT '           GROUP BY FirmaId, Barkod';
        PRINT '           HAVING COUNT(*) > 1';
        PRINT '       ) duplicates';
        PRINT '   )';
        PRINT '   ORDER BY u.FirmaId, u.Barkod, u.OlusturmaTarihi;';
        PRINT '';
        PRINT '   ⚠️  UNIQUE CONSTRAINT eklenemedi çünkü duplicate kayıtlar var!';
        PRINT '   ⚠️  Önce duplicate kayıtları temizlemeniz gerekiyor.';
        PRINT '';
        
        -- Rollback ve çık
        ROLLBACK TRANSACTION;
        RETURN;
    END
    ELSE
    BEGIN
        PRINT '   ✅ Duplicate barkod bulunamadı.';
    END;

    /* 2) UrunKodu için de duplicate kontrolü (bonus) */
    PRINT '';
    PRINT '2. Duplicate ürün kodu kayıtları kontrol ediliyor...';
    
    IF OBJECT_ID('tempdb..#DuplicateUrunKodlari') IS NOT NULL
        DROP TABLE #DuplicateUrunKodlari;
    
    SELECT 
        FirmaId,
        UrunKodu,
        COUNT(*) as Adet,
        STRING_AGG(CAST(Id AS NVARCHAR(MAX)), ', ') AS UrunIDler
    INTO #DuplicateUrunKodlari
    FROM Urunler
    WHERE UrunKodu IS NOT NULL AND LTRIM(RTRIM(UrunKodu)) <> ''
    GROUP BY FirmaId, UrunKodu
    HAVING COUNT(*) > 1;
    
    DECLARE @duplicate_urunkodu_count INT;
    SELECT @duplicate_urunkodu_count = COUNT(*) FROM #DuplicateUrunKodlari;
    
    IF @duplicate_urunkodu_count > 0
    BEGIN
        PRINT '   ⚠️  UYARI: ' + CAST(@duplicate_urunkodu_count AS NVARCHAR(10)) + ' adet duplicate ürün kodu grubu bulundu!';
        -- Detay rapor burada da eklenebilir
    END
    ELSE
    BEGIN
        PRINT '   ✅ Duplicate ürün kodu bulunamadı.';
    END;

    /* 3) Unique Index/Constraint Ekleme */
    PRINT '';
    PRINT '3. Unique constraint''ler ekleniyor...';
    
    -- 3a) Barkod için unique index
    IF NOT EXISTS (
        SELECT 1
        FROM sys.indexes i
        WHERE i.name = N'UX_Urunler_FirmaId_Barkod'
          AND i.object_id = OBJECT_ID(N'dbo.Urunler', N'U')
    )
    BEGIN
        -- Filtered index: Sadece NULL olmayan barkodlar için unique constraint
        -- Not: Boş string ('') değerleri de unique olarak kontrol edilir
        CREATE UNIQUE INDEX UX_Urunler_FirmaId_Barkod 
            ON dbo.Urunler (FirmaId, Barkod)
            WHERE Barkod IS NOT NULL;
        
        PRINT '   ✅ Barkod için unique constraint eklendi (UX_Urunler_FirmaId_Barkod)';
    END
    ELSE
    BEGIN
        PRINT '   ℹ️  Barkod unique constraint zaten mevcut.';
    END;
    
    -- 3b) UrunKodu için unique index
    IF NOT EXISTS (
        SELECT 1
        FROM sys.indexes i
        WHERE i.name = N'UX_Urunler_FirmaId_UrunKodu'
          AND i.object_id = OBJECT_ID(N'dbo.Urunler', N'U')
    )
    BEGIN
        -- Filtered index: Sadece NULL olmayan ürün kodları için unique constraint
        CREATE UNIQUE INDEX UX_Urunler_FirmaId_UrunKodu 
            ON dbo.Urunler (FirmaId, UrunKodu)
            WHERE UrunKodu IS NOT NULL;
        
        PRINT '   ✅ Ürün kodu için unique constraint eklendi (UX_Urunler_FirmaId_UrunKodu)';
    END
    ELSE
    BEGIN
        PRINT '   ℹ️  Ürün kodu unique constraint zaten mevcut.';
    END;

    PRINT '';
    PRINT '========================================';
    PRINT '✅ Migration başarıyla tamamlandı!';
    PRINT '========================================';
    PRINT '';
    PRINT 'Artık aynı firma içinde:';
    PRINT '  • Aynı barkodda 2. ürün eklenemez';
    PRINT '  • Aynı ürün kodunda 2. ürün eklenemez';
    PRINT '  • Race condition sorunu çözüldü';
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
    PRINT '❌ HATA: Migration başarısız!';
    PRINT '========================================';
    PRINT 'Hata Mesajı: ' + @ErrorMessage;
    PRINT 'Severity: ' + CAST(@ErrorSeverity AS NVARCHAR(10));
    PRINT 'State: ' + CAST(@ErrorState AS NVARCHAR(10));
    PRINT '';
    
    RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
END CATCH;
