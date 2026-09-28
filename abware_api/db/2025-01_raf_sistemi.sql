/*
  ABWare - Raf Bazlı Stok Yönetim Sistemi

  NOTLAR:
  - Bu script idempotent yazılmıştır: tablo/kolon varsa tekrar eklemez.
  - Raflar, RafStok ve RafHareketleri tabloları oluşturulur.
  - StokIslemleri tablosuna raf kolonları eklenir.
  - Özel raflar (Mal Kabul, Çıkış) otomatik oluşturulur.
*/

SET NOCOUNT ON;

BEGIN TRY
    BEGIN TRAN;

    /* 1) Raflar Tablosu */
    IF OBJECT_ID(N'dbo.Raflar', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.Raflar (
            Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Raflar PRIMARY KEY,
            FirmaId INT NOT NULL,
            RafKodu NVARCHAR(50) NOT NULL,
            RafAdi NVARCHAR(200) NOT NULL,
            RafTipi NVARCHAR(50) NULL, -- 'NORMAL', 'MAL_KABUL', 'CIKIS'
            Aktif BIT NOT NULL CONSTRAINT DF_Raflar_Aktif DEFAULT 1,
            OlusturmaTarihi DATETIME2(7) NOT NULL CONSTRAINT DF_Raflar_OlusturmaTarihi DEFAULT DATEADD(HOUR, 3, SYSUTCDATETIME()),
            GuncellemeTarihi DATETIME2(7) NULL,
            CONSTRAINT FK_Raflar_Firmalar FOREIGN KEY (FirmaId) REFERENCES dbo.Firmalar(Id)
        );
        
        -- Firma bazlı unique constraint: RafKodu
        CREATE UNIQUE INDEX UX_Raflar_FirmaId_RafKodu ON dbo.Raflar (FirmaId, RafKodu) WHERE Aktif = 1;
        
        -- Index: RafTipi için hızlı arama
        CREATE INDEX IX_Raflar_FirmaId_RafTipi ON dbo.Raflar (FirmaId, RafTipi) WHERE Aktif = 1;
    END;

    /* 2) RafStok Tablosu */
    IF OBJECT_ID(N'dbo.RafStok', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.RafStok (
            Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RafStok PRIMARY KEY,
            FirmaId INT NOT NULL,
            RafId INT NOT NULL,
            UrunId INT NOT NULL,
            Adet INT NOT NULL CONSTRAINT DF_RafStok_Adet DEFAULT 0,
            GuncellemeTarihi DATETIME2(7) NOT NULL CONSTRAINT DF_RafStok_GuncellemeTarihi DEFAULT DATEADD(HOUR, 3, SYSUTCDATETIME()),
            CONSTRAINT FK_RafStok_Raflar FOREIGN KEY (RafId) REFERENCES dbo.Raflar(Id),
            CONSTRAINT FK_RafStok_Urunler FOREIGN KEY (UrunId) REFERENCES dbo.Urunler(Id),
            CONSTRAINT FK_RafStok_Firmalar FOREIGN KEY (FirmaId) REFERENCES dbo.Firmalar(Id),
            CONSTRAINT UQ_RafStok_FirmaId_RafId_UrunId UNIQUE (FirmaId, RafId, UrunId)
        );
        
        -- Index: Raf bazlı stok sorgulama
        CREATE INDEX IX_RafStok_RafId_UrunId ON dbo.RafStok (RafId, UrunId);
        CREATE INDEX IX_RafStok_UrunId ON dbo.RafStok (UrunId);
    END;

    /* 3) RafHareketleri Tablosu */
    IF OBJECT_ID(N'dbo.RafHareketleri', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.RafHareketleri (
            Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RafHareketleri PRIMARY KEY,
            FirmaId INT NOT NULL,
            StokIslemiId INT NULL, -- İlişkili stok işlemi (opsiyonel)
            KaynakRafId INT NULL,
            HedefRafId INT NULL,
            UrunId INT NOT NULL,
            Miktar INT NOT NULL,
            IslemTipi NVARCHAR(50) NOT NULL, -- 'GIRIS', 'CIKIS', 'TRANSFER'
            KullaniciId INT NOT NULL,
            Tarih DATETIME2(7) NOT NULL CONSTRAINT DF_RafHareketleri_Tarih DEFAULT DATEADD(HOUR, 3, SYSUTCDATETIME()),
            Aciklama NVARCHAR(500) NULL,
            CONSTRAINT FK_RafHareketleri_StokIslemleri FOREIGN KEY (StokIslemiId) REFERENCES dbo.StokIslemleri(Id),
            CONSTRAINT FK_RafHareketleri_KaynakRaf FOREIGN KEY (KaynakRafId) REFERENCES dbo.Raflar(Id),
            CONSTRAINT FK_RafHareketleri_HedefRaf FOREIGN KEY (HedefRafId) REFERENCES dbo.Raflar(Id),
            CONSTRAINT FK_RafHareketleri_Urunler FOREIGN KEY (UrunId) REFERENCES dbo.Urunler(Id),
            CONSTRAINT FK_RafHareketleri_Kullanicilar FOREIGN KEY (KullaniciId) REFERENCES dbo.Kullanicilar(Id),
            CONSTRAINT FK_RafHareketleri_Firmalar FOREIGN KEY (FirmaId) REFERENCES dbo.Firmalar(Id)
        );
        
        -- Index: Tarih bazlı sorgulama
        CREATE INDEX IX_RafHareketleri_Tarih ON dbo.RafHareketleri (Tarih DESC);
        CREATE INDEX IX_RafHareketleri_RafId ON dbo.RafHareketleri (KaynakRafId, HedefRafId);
        CREATE INDEX IX_RafHareketleri_UrunId ON dbo.RafHareketleri (UrunId);
        CREATE INDEX IX_RafHareketleri_KullaniciId ON dbo.RafHareketleri (KullaniciId);
    END;

    /* 4) StokIslemleri Tablosuna Raf Kolonları Ekleme */
    IF COL_LENGTH('dbo.StokIslemleri', 'KaynakRafId') IS NULL
        ALTER TABLE dbo.StokIslemleri ADD KaynakRafId INT NULL;

    IF COL_LENGTH('dbo.StokIslemleri', 'HedefRafId') IS NULL
        ALTER TABLE dbo.StokIslemleri ADD HedefRafId INT NULL;

    -- Foreign key constraint'leri ekle (eğer yoksa)
    IF COL_LENGTH('dbo.StokIslemleri', 'KaynakRafId') IS NOT NULL
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM sys.foreign_keys 
            WHERE name = 'FK_StokIslemleri_KaynakRaf'
        )
        BEGIN
            ALTER TABLE dbo.StokIslemleri
                ADD CONSTRAINT FK_StokIslemleri_KaynakRaf 
                FOREIGN KEY (KaynakRafId) REFERENCES dbo.Raflar(Id);
        END;
    END;

    IF COL_LENGTH('dbo.StokIslemleri', 'HedefRafId') IS NOT NULL
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM sys.foreign_keys 
            WHERE name = 'FK_StokIslemleri_HedefRaf'
        )
        BEGIN
            ALTER TABLE dbo.StokIslemleri
                ADD CONSTRAINT FK_StokIslemleri_HedefRaf 
                FOREIGN KEY (HedefRafId) REFERENCES dbo.Raflar(Id);
        END;
    END;

    /* 5) Özel Rafları Oluştur (Her Firma İçin) */
    -- Mal Kabul Rafı
    DECLARE @FirmaId INT;
    DECLARE firma_cursor CURSOR FOR
        SELECT Id FROM dbo.Firmalar WHERE Aktif = 1;
    
    OPEN firma_cursor;
    FETCH NEXT FROM firma_cursor INTO @FirmaId;
    
    WHILE @@FETCH_STATUS = 0
    BEGIN
        -- Mal Kabul Rafı
        IF NOT EXISTS (
            SELECT 1 FROM dbo.Raflar 
            WHERE FirmaId = @FirmaId AND RafKodu = 'MAL-KABUL' AND RafTipi = 'MAL_KABUL'
        )
        BEGIN
            INSERT INTO dbo.Raflar (FirmaId, RafKodu, RafAdi, RafTipi, Aktif, OlusturmaTarihi)
            VALUES (@FirmaId, 'MAL-KABUL', 'Mal Kabul', 'MAL_KABUL', 1, DATEADD(HOUR, 3, SYSUTCDATETIME()));
        END;
        
        -- Çıkış Rafı
        IF NOT EXISTS (
            SELECT 1 FROM dbo.Raflar 
            WHERE FirmaId = @FirmaId AND RafKodu = 'CIKIS' AND RafTipi = 'CIKIS'
        )
        BEGIN
            INSERT INTO dbo.Raflar (FirmaId, RafKodu, RafAdi, RafTipi, Aktif, OlusturmaTarihi)
            VALUES (@FirmaId, 'CIKIS', 'Çıkış', 'CIKIS', 1, DATEADD(HOUR, 3, SYSUTCDATETIME()));
        END;
        
        FETCH NEXT FROM firma_cursor INTO @FirmaId;
    END;
    
    CLOSE firma_cursor;
    DEALLOCATE firma_cursor;

    COMMIT;
    PRINT 'Raf sistemi başarıyla oluşturuldu.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    DECLARE @err NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@err, 16, 1);
END CATCH;
