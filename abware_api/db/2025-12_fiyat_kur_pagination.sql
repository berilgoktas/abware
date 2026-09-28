/*
  ABWare - Ürün Fiyat (TL/EUR) + Günlük EURTRY Kur Cache + Stok Hareket Fiyat Kaydı

  NOTLAR:
  - Bu script idempotent yazılmıştır: tablo/kolon varsa tekrar eklemez.
  - Hassasiyet (kullanıcı seçimi): TL=decimal(18,4), EUR=decimal(18,6), Kur=decimal(18,8)
*/

SET NOCOUNT ON;

BEGIN TRY
    BEGIN TRAN;

    /* 1) Kur cache tablosu */
    IF OBJECT_ID(N'dbo.DovizKurlari', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.DovizKurlari (
            Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DovizKurlari PRIMARY KEY,
            Tarih DATE NOT NULL,
            EURTRY DECIMAL(18,8) NOT NULL,
            Kaynak NVARCHAR(200) NULL,
            -- Türkiye saati (UTC+3) olarak kaydet
            OlusturmaTarihi DATETIME2(7) NOT NULL CONSTRAINT DF_DovizKurlari_OlusturmaTarihi DEFAULT DATEADD(HOUR, 3, SYSUTCDATETIME())
        );
    END;

    /* 1b) Mevcut kurulumlarda default constraint UTC kalmış olabilir -> TR'ye çek (idempotent) */
    IF OBJECT_ID(N'dbo.DovizKurlari', N'U') IS NOT NULL
    BEGIN
        DECLARE @df_name SYSNAME;
        DECLARE @df_def NVARCHAR(MAX);

        SELECT TOP 1
            @df_name = dc.name,
            @df_def = dc.definition
        FROM sys.default_constraints dc
        INNER JOIN sys.columns c
            ON c.object_id = dc.parent_object_id
           AND c.column_id = dc.parent_column_id
        WHERE dc.parent_object_id = OBJECT_ID(N'dbo.DovizKurlari', N'U')
          AND c.name = N'OlusturmaTarihi';

        -- DEFAULT yoksa ekle; varsa ama TR değilse drop+add
        IF @df_name IS NULL
        BEGIN
            ALTER TABLE dbo.DovizKurlari
                ADD CONSTRAINT DF_DovizKurlari_OlusturmaTarihi
                DEFAULT DATEADD(HOUR, 3, SYSUTCDATETIME()) FOR OlusturmaTarihi;
        END
        ELSE IF @df_def IS NOT NULL AND @df_def NOT LIKE N'%DATEADD(HOUR, 3%'
        BEGIN
            DECLARE @sql NVARCHAR(MAX) =
                N'ALTER TABLE dbo.DovizKurlari DROP CONSTRAINT ' + QUOTENAME(@df_name) + N';';
            EXEC sp_executesql @sql;

            ALTER TABLE dbo.DovizKurlari
                ADD CONSTRAINT DF_DovizKurlari_OlusturmaTarihi
                DEFAULT DATEADD(HOUR, 3, SYSUTCDATETIME()) FOR OlusturmaTarihi;
        END
    END;

    -- Unique index: Tarih kolonu için (idempotent)
    IF OBJECT_ID(N'dbo.DovizKurlari', N'U') IS NOT NULL
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM sys.indexes i
            WHERE i.name = N'UX_DovizKurlari_Tarih'
              AND i.object_id = OBJECT_ID(N'dbo.DovizKurlari', N'U')
        )
        BEGIN
            CREATE UNIQUE INDEX UX_DovizKurlari_Tarih ON dbo.DovizKurlari (Tarih);
        END;
    END;

    /* 2) Urunler tablosu kolonları */
    IF COL_LENGTH('dbo.Urunler', 'FiyatTL') IS NULL
        ALTER TABLE dbo.Urunler ADD FiyatTL DECIMAL(18,4) NULL;

    IF COL_LENGTH('dbo.Urunler', 'FiyatEUR') IS NULL
        ALTER TABLE dbo.Urunler ADD FiyatEUR DECIMAL(18,6) NULL;

    IF COL_LENGTH('dbo.Urunler', 'KurEURTRY') IS NULL
        ALTER TABLE dbo.Urunler ADD KurEURTRY DECIMAL(18,8) NULL;

    IF COL_LENGTH('dbo.Urunler', 'KurTarihi') IS NULL
        ALTER TABLE dbo.Urunler ADD KurTarihi DATE NULL;

    /* 3) StokIslemleri tablosu kolonları (hareket anındaki birim fiyat) */
    IF COL_LENGTH('dbo.StokIslemleri', 'BirimFiyatEUR') IS NULL
        ALTER TABLE dbo.StokIslemleri ADD BirimFiyatEUR DECIMAL(18,6) NULL;

    IF COL_LENGTH('dbo.StokIslemleri', 'BirimFiyatTL') IS NULL
        ALTER TABLE dbo.StokIslemleri ADD BirimFiyatTL DECIMAL(18,4) NULL;

    IF COL_LENGTH('dbo.StokIslemleri', 'KurEURTRY') IS NULL
        ALTER TABLE dbo.StokIslemleri ADD KurEURTRY DECIMAL(18,8) NULL;

    IF COL_LENGTH('dbo.StokIslemleri', 'KurTarihi') IS NULL
        ALTER TABLE dbo.StokIslemleri ADD KurTarihi DATE NULL;

    /* 4) StokIslemleri.IslemTipi Türkçeleştirme: İPTAL EDİLDİ - API ve DB formatı değişmeyecek */
    -- Not: Kullanıcı isteği üzerine değişiklik yapılmadı. "giris"/"cikis" formatı korunuyor.

    COMMIT;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    DECLARE @err NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@err, 16, 1);
END CATCH;



