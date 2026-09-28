/*
  ABWare - StokIslemleri Aciklama Kolonu Kontrolü ve Ekleme Scripti
  
  NOTLAR:
  - Bu script idempotent yazılmıştır: kolon varsa tekrar eklemez.
  - StokIslemleri tablosunda Aciklama kolonu kontrolü yapılır.
  - Kolon yoksa eklenir.
*/

SET NOCOUNT ON;

BEGIN TRY
    BEGIN TRAN;

    /* StokIslemleri tablosunda Aciklama kolonu kontrolü */
    IF COL_LENGTH('dbo.StokIslemleri', 'Aciklama') IS NULL
    BEGIN
        ALTER TABLE dbo.StokIslemleri 
            ADD Aciklama NVARCHAR(500) NULL;
        
        PRINT 'StokIslemleri.Aciklama kolonu başarıyla eklendi.';
    END
    ELSE
    BEGIN
        PRINT 'StokIslemleri.Aciklama kolonu zaten mevcut.';
    END

    COMMIT;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    DECLARE @err NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@err, 16, 1);
END CATCH;
