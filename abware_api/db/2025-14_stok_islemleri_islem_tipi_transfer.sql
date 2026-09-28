/*
  ABWare - StokIslemleri IslemTipi: 'transfer' değerine izin ver

  transfer-v2 endpoint'i StokIslemleri'ne IslemTipi = 'transfer' ile kayıt atıyor.
  Mevcut CHK_StokIslemleri_IslemTipi sadece 'giris' ve 'cikis' kabul ediyor.
  Bu script constraint'i güncelleyerek 'transfer' değerini de kabul etmesini sağlar.

  Idempotent: Constraint yoksa hata vermez, yenisini ekler.
*/

SET NOCOUNT ON;

BEGIN TRY
    BEGIN TRAN;

    IF EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE name = N'CHK_StokIslemleri_IslemTipi'
          AND parent_object_id = OBJECT_ID(N'dbo.StokIslemleri', N'U')
    )
    BEGIN
        ALTER TABLE dbo.StokIslemleri
            DROP CONSTRAINT CHK_StokIslemleri_IslemTipi;
    END;

    ALTER TABLE dbo.StokIslemleri
        ADD CONSTRAINT CHK_StokIslemleri_IslemTipi
        CHECK (IslemTipi IN ('giris', 'cikis', 'transfer'));

    PRINT 'CHK_StokIslemleri_IslemTipi güncellendi; giris, cikis, transfer kabul ediliyor.';

    COMMIT;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    DECLARE @err NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@err, 16, 1);
END CATCH;
