"""
ABWareDB_Test için gerçekçi demo veri.

Production (ABWareDB) dokunulmaz.
Roller + TEST firması + admin kullanıcısı korunur.
"""
import os
import sys
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import bcrypt
import pyodbc
from dotenv import load_dotenv

_BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(dotenv_path=_BASE_DIR / ".env", override=False)

DB_NAME = os.getenv("DB_DATABASE", "")
if DB_NAME != "ABWareDB_Test":
    print(f"Durduruldu: hedef {DB_NAME}, yalnızca ABWareDB_Test.")
    sys.exit(1)


def _conn_str() -> str:
    server = (os.getenv("DB_SERVER") or "").strip()
    if server and not server.lower().startswith(("tcp:", "np:", "lpc:")):
        server = f"tcp:{server}"
    return (
        f"DRIVER={{{os.getenv('DB_DRIVER')}}};"
        f"SERVER={server};"
        f"DATABASE={DB_NAME};"
        f"UID={os.getenv('DB_USERNAME')};"
        f"PWD={os.getenv('DB_PASSWORD')};"
        f"Encrypt={os.getenv('DB_ENCRYPT')};"
        f"TrustServerCertificate={os.getenv('DB_TRUST_CERT')};"
    )


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _insert_id(cur, sql: str, params) -> int:
    cur.execute(sql, params)
    row = cur.fetchone()
    return int(row[0])


def main():
    conn = pyodbc.connect(_conn_str(), timeout=30)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        print("Hedef:", DB_NAME)

        cur.execute("SELECT TOP 1 EURTRY FROM DovizKurlari ORDER BY Tarih DESC")
        kur_row = cur.fetchone()
        kur = Decimal(str(kur_row[0])) if kur_row else Decimal("51.273")
        kur_tarihi = date.today()

        cur.execute("SELECT Id FROM Firmalar WHERE Kod = N'TEST'")
        firma = cur.fetchone()
        if not firma:
            raise RuntimeError("TEST firması yok")
        firma_id = int(firma[0])

        cur.execute(
            "SELECT Id FROM Kullanicilar WHERE FirmaId = ? AND KullaniciAdi = N'admin'",
            (firma_id,),
        )
        admin = cur.fetchone()
        if not admin:
            raise RuntimeError("admin kullanıcısı yok")
        admin_id = int(admin[0])

        cur.execute("DELETE FROM RafHareketleri")
        cur.execute("DELETE FROM RafStok")
        cur.execute("DELETE FROM StokIslemleri")
        cur.execute("DELETE FROM IslemGecmisi")
        cur.execute("DELETE FROM Urunler")
        cur.execute("DELETE FROM Raflar")
        cur.execute(
            "DELETE FROM KullaniciRolleri WHERE KullaniciId <> ?",
            (admin_id,),
        )
        cur.execute("DELETE FROM Kullanicilar WHERE Id <> ?", (admin_id,))
        cur.execute("DELETE FROM Firmalar WHERE Id <> ?", (firma_id,))

        cur.execute(
            "UPDATE Firmalar SET Ad = N'ABWare Demo Depo', "
            "Aciklama = N'Demo depo firması (test verisi)' WHERE Id = ?",
            (firma_id,),
        )
        cur.execute(
            "UPDATE Kullanicilar SET AdSoyad = N'Depo Yöneticisi', "
            "Email = N'admin@abware-demo.local' WHERE Id = ?",
            (admin_id,),
        )
        cur.execute(
            """
            INSERT INTO KullaniciRolleri (KullaniciId, RolId, OlusturmaTarihi)
            SELECT ?, r.Id, DATEADD(HOUR, 3, SYSUTCDATETIME())
            FROM Roller r
            WHERE NOT EXISTS (
                SELECT 1 FROM KullaniciRolleri kr
                WHERE kr.KullaniciId = ? AND kr.RolId = r.Id
            )
            """,
            (admin_id, admin_id),
        )

        depo_id = _insert_id(
            cur,
            """
            INSERT INTO Kullanicilar
                (FirmaId, KullaniciAdi, SifreHash, AdSoyad, Email, Aktif, IsSuperAdmin, OlusturmaTarihi)
            OUTPUT INSERTED.Id
            VALUES (?, N'depo', ?, N'Ahmet Yılmaz', N'depo@abware-demo.local', 1, 0,
                    DATEADD(HOUR, 3, SYSUTCDATETIME()))
            """,
            (firma_id, _hash("depo123")),
        )
        cur.execute(
            """
            INSERT INTO KullaniciRolleri (KullaniciId, RolId, OlusturmaTarihi)
            SELECT ?, Id, DATEADD(HOUR, 3, SYSUTCDATETIME())
            FROM Roller
            WHERE Id IN (3, 4, 5, 10)
            """,
            (depo_id,),
        )

        raf_sql = """
            INSERT INTO Raflar (FirmaId, RafKodu, RafAdi, RafTipi, Aktif, OlusturmaTarihi)
            OUTPUT INSERTED.Id
            VALUES (?, ?, ?, ?, 1, DATEADD(HOUR, 3, SYSUTCDATETIME()))
        """
        raf = {}
        for kod, ad, tip in (
            ("MAL-KABUL", "Mal Kabul", "MAL_KABUL"),
            ("CIKIS", "Sevkiyat", "CIKIS"),
            ("A-01-01", "Cıvata / Somun", "NORMAL"),
            ("A-01-02", "Pul / Aksesuar", "NORMAL"),
            ("A-02-01", "Elektrik Malzeme", "NORMAL"),
            ("B-01-01", "Ambalaj", "NORMAL"),
            ("B-02-01", "Palet Alanı", "NORMAL"),
        ):
            raf[kod] = _insert_id(cur, raf_sql, (firma_id, kod, ad, tip))

        urunler = [
            # kod, ad, barkod, birim, aciklama, kritik, reel, giris, cikis, fiyat_tl
            ("CIV-M8-20", "M8x20 Imbüs Cıvata", "8681110000001", "adet",
             "8.8 kalite çelik cıvata", 80, 240, 300, 60, Decimal("2.40")),
            ("SOM-M8", "M8 Somun", "8681110000002", "adet",
             "Standart altı köşe somun", 100, 45, 200, 155, Decimal("0.80")),
            ("PLN-M8", "M8 Pul", "8681110000003", "adet",
             "Düz çelik pul", 100, 320, 400, 80, Decimal("0.25")),
            ("KBL-NYM315", "NYM 3x1.5 Kablo", "8681110000004", "metre",
             "Tesisat kablosu, 100 m kangal", 20, 86, 120, 34, Decimal("18.50")),
            ("STR-50CM", "Streç Film 50 cm", "8681110000005", "rulo",
             "Palet sarma filmi", 15, 42, 60, 18, Decimal("95.00")),
            ("PLT-EUR", "Euro Palet 80x120", "8681110000006", "adet",
             "EPAL uyumlu ahşap palet", 10, 8, 24, 16, Decimal("185.00")),
            ("AMP-LED10", "10W LED Ampul E27", "8681110000007", "adet",
             "2700K sıcak beyaz", 30, 150, 180, 30, Decimal("42.90")),
            ("ELD-NITRIL", "Nitril İş Eldiveni", "8681110000008", "çift",
             "Kimyasal dirençli, L beden", 25, 64, 80, 16, Decimal("12.50")),
            ("BNT-MASK50", "Maskeleme Bandı 50 mm", "8681110000009", "adet",
             "Boya koruma bandı", 20, 110, 140, 30, Decimal("28.00")),
            ("BRU-20MM", "20 mm PVC Boru", "8681110000010", "adet",
             "3 metre elektrik borusu", 40, 95, 120, 25, Decimal("22.00")),
            ("PRZ-16A", "16A Topraklı Priz", "8681110000011", "adet",
             "Sıva altı priz", 20, 12, 48, 36, Decimal("36.75")),
            ("KOL-KARTON", "Karton Koli 40x30x30", "8681110000012", "adet",
             "Çift oluklu koli", 50, 210, 250, 40, Decimal("9.90")),
        ]

        urun_sql = """
            INSERT INTO Urunler (
                FirmaId, UrunKodu, UrunAdi, Barkod, Aciklama, KritikStok, ReelStok,
                ToplamGiris, ToplamCikis, OlusturmaTarihi, Aktif, AdetTuru,
                FiyatTL, FiyatEUR, KurEURTRY, KurTarihi
            )
            OUTPUT INSERTED.Id
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()), 1, ?, ?, ?, ?, ?)
        """
        urun = {}
        for kod, ad, barkod, birim, aciklama, kritik, reel, giris, cikis, fiyat_tl in urunler:
            fiyat_eur = (fiyat_tl / kur).quantize(Decimal("0.000001"))
            urun[kod] = _insert_id(
                cur,
                urun_sql,
                (
                    firma_id, kod, ad, barkod, aciklama, kritik, reel, giris, cikis,
                    birim, fiyat_tl, fiyat_eur, kur, kur_tarihi,
                ),
            )

        raf_stok = [
            ("CIV-M8-20", "A-01-01", 200),
            ("CIV-M8-20", "MAL-KABUL", 40),
            ("SOM-M8", "A-01-01", 45),
            ("PLN-M8", "A-01-02", 280),
            ("PLN-M8", "MAL-KABUL", 40),
            ("KBL-NYM315", "A-02-01", 70),
            ("KBL-NYM315", "MAL-KABUL", 16),
            ("STR-50CM", "B-01-01", 42),
            ("PLT-EUR", "B-02-01", 8),
            ("AMP-LED10", "A-02-01", 130),
            ("AMP-LED10", "CIKIS", 20),
            ("ELD-NITRIL", "B-01-01", 64),
            ("BNT-MASK50", "B-01-01", 90),
            ("BNT-MASK50", "A-01-02", 20),
            ("BRU-20MM", "A-02-01", 95),
            ("PRZ-16A", "A-02-01", 12),
            ("KOL-KARTON", "B-01-01", 180),
            ("KOL-KARTON", "CIKIS", 30),
        ]
        for kod, raf_kod, adet in raf_stok:
            cur.execute(
                """
                INSERT INTO RafStok (FirmaId, RafId, UrunId, Adet, GuncellemeTarihi)
                VALUES (?, ?, ?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()))
                """,
                (firma_id, raf[raf_kod], urun[kod], adet),
            )

        now = datetime.now()
        today = now.replace(hour=9, minute=15, second=0, microsecond=0)
        d1 = today - timedelta(days=1)
        d3 = today - timedelta(days=3)
        d7 = today - timedelta(days=7)

        def fiyatlar(kod: str):
            row = next(u for u in urunler if u[0] == kod)
            fiyat_tl = row[9]
            fiyat_eur = (fiyat_tl / kur).quantize(Decimal("0.000001"))
            return fiyat_eur, fiyat_tl

        def stok_islem(kod, tip, miktar, aciklama, kullanici, tarih, kaynak=None, hedef=None):
            fiyat_eur, fiyat_tl = fiyatlar(kod)
            return _insert_id(
                cur,
                """
                INSERT INTO StokIslemleri (
                    FirmaId, UrunId, IslemTipi, Miktar, Aciklama, KullaniciId, Tarih,
                    BirimFiyatEUR, BirimFiyatTL, KurEURTRY, KurTarihi, KaynakRafId, HedefRafId
                )
                OUTPUT INSERTED.Id
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    firma_id, urun[kod], tip, miktar, aciklama, kullanici, tarih,
                    fiyat_eur, fiyat_tl, kur, kur_tarihi,
                    raf[kaynak] if kaynak else None,
                    raf[hedef] if hedef else None,
                ),
            )

        def raf_hareket(stok_id, kaynak, hedef, kod, miktar, tip, kullanici, tarih, aciklama):
            cur.execute(
                """
                INSERT INTO RafHareketleri (
                    FirmaId, StokIslemiId, KaynakRafId, HedefRafId, UrunId,
                    Miktar, IslemTipi, KullaniciId, Tarih, Aciklama
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    firma_id, stok_id,
                    raf[kaynak] if kaynak else None,
                    raf[hedef] if hedef else None,
                    urun[kod], miktar, tip, kullanici, tarih, aciklama,
                ),
            )

        sid = stok_islem("CIV-M8-20", "giris", 300, "Tedarikçi teslimatı", admin_id, d7, hedef="MAL-KABUL")
        raf_hareket(sid, None, "MAL-KABUL", "CIV-M8-20", 300, "GIRIS", admin_id, d7, "Mal kabule giriş")
        sid = stok_islem("CIV-M8-20", "transfer", 200, "Rafa yerleştirme", depo_id, d7 + timedelta(hours=2), "MAL-KABUL", "A-01-01")
        raf_hareket(sid, "MAL-KABUL", "A-01-01", "CIV-M8-20", 200, "TRANSFER", depo_id, d7 + timedelta(hours=2), "A koridoruna transfer")
        sid = stok_islem("CIV-M8-20", "cikis", 60, "Üretim siparişi SK-1042", depo_id, d3, "A-01-01", "CIKIS")
        raf_hareket(sid, "A-01-01", "CIKIS", "CIV-M8-20", 60, "CIKIS", depo_id, d3, "Sevkiyata alındı")

        sid = stok_islem("SOM-M8", "giris", 200, "Somun tedarik", admin_id, d7, hedef="MAL-KABUL")
        raf_hareket(sid, None, "MAL-KABUL", "SOM-M8", 200, "GIRIS", admin_id, d7, "Mal kabule giriş")
        sid = stok_islem("SOM-M8", "transfer", 200, "Rafa yerleştirme", depo_id, d7 + timedelta(hours=3), "MAL-KABUL", "A-01-01")
        raf_hareket(sid, "MAL-KABUL", "A-01-01", "SOM-M8", 200, "TRANSFER", depo_id, d7 + timedelta(hours=3), "Cıvata rafına")
        sid = stok_islem("SOM-M8", "cikis", 155, "Montaj hattı", depo_id, d1, "A-01-01", "CIKIS")
        raf_hareket(sid, "A-01-01", "CIKIS", "SOM-M8", 155, "CIKIS", depo_id, d1, "Kritik stok kaldı")

        sid = stok_islem("AMP-LED10", "giris", 180, "Aydınlatma alımı", admin_id, d3, hedef="MAL-KABUL")
        raf_hareket(sid, None, "MAL-KABUL", "AMP-LED10", 180, "GIRIS", admin_id, d3, "Mal kabule giriş")
        sid = stok_islem("AMP-LED10", "transfer", 160, "Elektrik rafına", depo_id, d3 + timedelta(hours=1), "MAL-KABUL", "A-02-01")
        raf_hareket(sid, "MAL-KABUL", "A-02-01", "AMP-LED10", 160, "TRANSFER", depo_id, d3 + timedelta(hours=1), "Yerleşim")
        sid = stok_islem("AMP-LED10", "cikis", 20, "Ofis yenileme", depo_id, today, "A-02-01", "CIKIS")
        raf_hareket(sid, "A-02-01", "CIKIS", "AMP-LED10", 20, "CIKIS", depo_id, today, "Bugünkü çıkış")

        sid = stok_islem("KOL-KARTON", "giris", 250, "Koli tedarik", admin_id, d1, hedef="MAL-KABUL")
        raf_hareket(sid, None, "MAL-KABUL", "KOL-KARTON", 250, "GIRIS", admin_id, d1, "Mal kabule giriş")
        sid = stok_islem("KOL-KARTON", "transfer", 220, "Ambalaj rafına", depo_id, d1 + timedelta(hours=2), "MAL-KABUL", "B-01-01")
        raf_hareket(sid, "MAL-KABUL", "B-01-01", "KOL-KARTON", 220, "TRANSFER", depo_id, d1 + timedelta(hours=2), "Yerleşim")
        sid = stok_islem("KOL-KARTON", "cikis", 40, "Sevkiyat hazırlık", depo_id, today + timedelta(hours=1), "B-01-01", "CIKIS")
        raf_hareket(sid, "B-01-01", "CIKIS", "KOL-KARTON", 40, "CIKIS", depo_id, today + timedelta(hours=1), "Bugünkü çıkış")

        sid = stok_islem("PLT-EUR", "giris", 24, "Palet alımı", admin_id, d7, hedef="MAL-KABUL")
        raf_hareket(sid, None, "MAL-KABUL", "PLT-EUR", 24, "GIRIS", admin_id, d7, "Mal kabule giriş")
        sid = stok_islem("PLT-EUR", "transfer", 24, "Palet alanına", depo_id, d7 + timedelta(hours=4), "MAL-KABUL", "B-02-01")
        raf_hareket(sid, "MAL-KABUL", "B-02-01", "PLT-EUR", 24, "TRANSFER", depo_id, d7 + timedelta(hours=4), "Yerleşim")
        sid = stok_islem("PLT-EUR", "cikis", 16, "Müşteri sevkiyatı", depo_id, today, "B-02-01", "CIKIS")
        raf_hareket(sid, "B-02-01", "CIKIS", "PLT-EUR", 16, "CIKIS", depo_id, today, "Bugünkü çıkış")

        sid = stok_islem("PRZ-16A", "giris", 48, "Priz tedarik", admin_id, d3, hedef="MAL-KABUL")
        raf_hareket(sid, None, "MAL-KABUL", "PRZ-16A", 48, "GIRIS", admin_id, d3, "Mal kabule giriş")
        sid = stok_islem("PRZ-16A", "transfer", 48, "Elektrik rafına", depo_id, d3 + timedelta(hours=2), "MAL-KABUL", "A-02-01")
        raf_hareket(sid, "MAL-KABUL", "A-02-01", "PRZ-16A", 48, "TRANSFER", depo_id, d3 + timedelta(hours=2), "Yerleşim")
        sid = stok_islem("PRZ-16A", "cikis", 36, "Şantiye teslim", depo_id, d1, "A-02-01", "CIKIS")
        raf_hareket(sid, "A-02-01", "CIKIS", "PRZ-16A", 36, "CIKIS", depo_id, d1, "Kritik stok")

        sid = stok_islem("STR-50CM", "giris", 60, "Streç film alımı", depo_id, today, hedef="MAL-KABUL")
        raf_hareket(sid, None, "MAL-KABUL", "STR-50CM", 60, "GIRIS", depo_id, today, "Bugünkü giriş")
        sid = stok_islem("STR-50CM", "transfer", 42, "Ambalaj rafına", depo_id, today + timedelta(minutes=40), "MAL-KABUL", "B-01-01")
        raf_hareket(sid, "MAL-KABUL", "B-01-01", "STR-50CM", 42, "TRANSFER", depo_id, today + timedelta(minutes=40), "Yerleşim")

        for kod, ad, *_rest in urunler:
            cur.execute(
                """
                INSERT INTO IslemGecmisi (FirmaId, IslemTipi, Aciklama, KullaniciId, UrunId, Tarih)
                VALUES (?, N'urun_ekleme', ?, ?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()))
                """,
                (firma_id, f"Demo ürün eklendi: {kod} - {ad}", admin_id, urun[kod]),
            )

        conn.commit()
        print("Tamam. Demo veri yüklendi.")
        print("Giriş: firma TEST / admin")
        print("Depo personeli: depo")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
