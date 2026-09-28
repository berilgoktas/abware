"""
Test veritabanı için yapılandırma scripti

Bu script:
1. Mevcut veritabanından (ABWareDB) rolleri çeker
2. Test veritabanına (ABWareDB_Test) rolleri ekler (birebir aynı)
3. Yeni firma ekler
4. Yeni kullanıcı ekler (süper admin)
5. Kullanıcıya tüm rolleri atar
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import pyodbc
import bcrypt

# .env dosyasını yükle
_BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=_BASE_DIR / ".env", override=False)

# Bağlantı bilgileri
DB_SERVER = os.getenv('DB_SERVER', '10.0.0.4,1433')
DB_USERNAME = os.getenv('DB_USERNAME', 'sa')
DB_PASSWORD = os.getenv('DB_PASSWORD', '')
DB_DRIVER = os.getenv('DB_DRIVER', 'ODBC Driver 18 for SQL Server')
DB_ENCRYPT = os.getenv('DB_ENCRYPT', 'yes')
DB_TRUST_CERT = os.getenv('DB_TRUST_CERT', 'yes')

# Veritabanı adları
PROD_DATABASE = 'ABWareDB'  # Mevcut veritabanı
TEST_DATABASE = 'ABWareDB_Test'  # Test veritabanı

def get_connection_string(database: str, driver: str = None) -> str:
    """Veritabanı bağlantı string'i oluştur"""
    if driver is None:
        # Mevcut driver'ları kontrol et
        import pyodbc
        installed_drivers = pyodbc.drivers()
        if DB_DRIVER in installed_drivers:
            driver = DB_DRIVER
        elif "ODBC Driver 17 for SQL Server" in installed_drivers:
            driver = "ODBC Driver 17 for SQL Server"
        elif "SQL Server" in installed_drivers:
            driver = "SQL Server"
        else:
            driver = DB_DRIVER  # Fallback
    
    server = DB_SERVER.strip()
    if server and not server.lower().startswith(("tcp:", "np:", "lpc:")):
        server = f"tcp:{server}"
    
    return (
        f"DRIVER={{{driver}}};"
        f"SERVER={server};"
        f"DATABASE={database};"
        f"UID={DB_USERNAME};"
        f"PWD={DB_PASSWORD};"
        f"Encrypt={DB_ENCRYPT};"
        f"TrustServerCertificate={DB_TRUST_CERT};"
    )

# Test firma bilgileri
TEST_FIRMA = {
    "kod": "TEST",
    "ad": "Test Firma",
    "aciklama": "Test amaçlı firma",
    "aktif": True,
}

# Test kullanıcı bilgileri
TEST_KULLANICI = {
    "kullanici_adi": "admin",
    "sifre": "admin123",
    "ad_soyad": "Test Admin",
    "email": "admin@test.com",
    "is_super_admin": True,
    "aktif": True,
}


def hash_password(password: str) -> str:
    """Şifreyi bcrypt ile hash'le"""
    password_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')


def setup_test_database():
    """Test veritabanını yapılandır"""
    print("=" * 60)
    print("Test Veritabanı Yapılandırma Scripti")
    print("=" * 60)
    print(f"Kaynak Veritabanı: {PROD_DATABASE}")
    print(f"Hedef Veritabanı: {TEST_DATABASE}")
    print(f"Sunucu: {DB_SERVER}")
    print("=" * 60)
    
    try:
        # 1. Mevcut veritabanından rolleri çek
        print("\n1. Mevcut veritabanından rolleri çekiliyor...")
        import pyodbc
        prod_conn = pyodbc.connect(get_connection_string(PROD_DATABASE), timeout=30)
        prod_cursor = prod_conn.cursor()
        
        prod_cursor.execute("SELECT Id, Ad, Aciklama FROM Roller ORDER BY Id ASC")
        prod_roles = []
        for row in prod_cursor.fetchall():
            prod_roles.append({
                "id": row[0],
                "ad": row[1],
                "aciklama": row[2] if len(row) > 2 and row[2] else None,
            })
        
        prod_cursor.close()
        prod_conn.close()
        
        print(f"   - {len(prod_roles)} rol bulundu")
        for rol in prod_roles:
            print(f"     • {rol['ad']} (ID: {rol['id']})")
        
        # 2. Test veritabanına bağlan
        print(f"\n2. Test veritabanına bağlanılıyor: {TEST_DATABASE}")
        test_conn = pyodbc.connect(get_connection_string(TEST_DATABASE), timeout=30)
        test_conn.autocommit = False
        test_cursor = test_conn.cursor()
        
        print("   - Bağlantı başarılı")
        
        # 3. Test veritabanına rolleri ekle
        print("\n3. Test veritabanına rolleri ekleniyor...")
        
        # Mevcut rolleri kontrol et
        test_cursor.execute("SELECT Ad FROM Roller")
        existing_roles = {row[0] for row in test_cursor.fetchall()}
        
        role_ids = {}
        for rol in prod_roles:
            rol_adi = rol["ad"]
            rol_aciklama = rol.get("aciklama")
            
            if rol_adi in existing_roles:
                # Mevcut rolü al
                test_cursor.execute("SELECT Id FROM Roller WHERE Ad = ?", (rol_adi,))
                row = test_cursor.fetchone()
                role_ids[rol_adi] = row[0] if row else None
                print(f"   - Rol zaten mevcut: {rol_adi} (ID: {role_ids[rol_adi]})")
            else:
                # Yeni rol ekle
                test_cursor.execute(
                    """
                    INSERT INTO Roller (Ad, Aciklama, OlusturmaTarihi)
                    OUTPUT INSERTED.Id
                    VALUES (?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()))
                    """,
                    (rol_adi, rol_aciklama),
                )
                row = test_cursor.fetchone()
                role_id = row[0] if row else None
                role_ids[rol_adi] = role_id
                print(f"   - Yeni rol eklendi: {rol_adi} (ID: {role_id})")
        
        test_conn.commit()
        
        # 4. Test firması ekle
        print("\n4. Test firması ekleniyor...")
        
        test_cursor.execute("SELECT Id FROM Firmalar WHERE Kod = ?", (TEST_FIRMA["kod"],))
        firma_row = test_cursor.fetchone()
        
        if firma_row:
            firma_id = firma_row[0]
            print(f"   - Firma zaten mevcut: {TEST_FIRMA['kod']} (ID: {firma_id})")
            
            # Firma bilgilerini güncelle
            test_cursor.execute(
                """
                UPDATE Firmalar
                SET Ad = ?, Aciklama = ?, Aktif = ?
                WHERE Id = ?
                """,
                (
                    TEST_FIRMA["ad"],
                    TEST_FIRMA["aciklama"],
                    1 if TEST_FIRMA["aktif"] else 0,
                    firma_id,
                ),
            )
            print(f"   - Firma bilgileri güncellendi")
        else:
            # Yeni firma ekle
            test_cursor.execute(
                """
                INSERT INTO Firmalar (Kod, Ad, Aciklama, Aktif, OlusturmaTarihi)
                OUTPUT INSERTED.Id
                VALUES (?, ?, ?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()))
                """,
                (
                    TEST_FIRMA["kod"],
                    TEST_FIRMA["ad"],
                    TEST_FIRMA["aciklama"],
                    1 if TEST_FIRMA["aktif"] else 0,
                ),
            )
            row = test_cursor.fetchone()
            firma_id = row[0] if row else None
            print(f"   - Yeni firma eklendi: {TEST_FIRMA['kod']} (ID: {firma_id})")
        
        test_conn.commit()
        
        # 5. Test kullanıcısı ekle
        print("\n5. Test kullanıcısı ekleniyor...")
        
        test_cursor.execute(
            "SELECT Id FROM Kullanicilar WHERE FirmaId = ? AND KullaniciAdi = ?",
            (firma_id, TEST_KULLANICI["kullanici_adi"]),
        )
        kullanici_row = test_cursor.fetchone()
        
        if kullanici_row:
            kullanici_id = kullanici_row[0]
            print(f"   - Kullanıcı zaten mevcut: {TEST_KULLANICI['kullanici_adi']} (ID: {kullanici_id})")
            
            # Şifreyi hash'le
            sifre_hash = hash_password(TEST_KULLANICI["sifre"])
            
            # Kullanıcıyı güncelle
            test_cursor.execute(
                """
                UPDATE Kullanicilar
                SET SifreHash = ?, AdSoyad = ?, Email = ?, IsSuperAdmin = ?, Aktif = ?
                WHERE Id = ?
                """,
                (
                    sifre_hash,
                    TEST_KULLANICI["ad_soyad"],
                    TEST_KULLANICI["email"],
                    1 if TEST_KULLANICI["is_super_admin"] else 0,
                    1 if TEST_KULLANICI["aktif"] else 0,
                    kullanici_id,
                ),
            )
            print(f"   - Kullanıcı güncellendi (şifre yenilendi)")
        else:
            # Şifreyi hash'le
            sifre_hash = hash_password(TEST_KULLANICI["sifre"])
            
            # Yeni kullanıcı ekle
            test_cursor.execute(
                """
                INSERT INTO Kullanicilar (
                    FirmaId, KullaniciAdi, SifreHash, AdSoyad, Email, 
                    IsSuperAdmin, Aktif, OlusturmaTarihi
                )
                OUTPUT INSERTED.Id
                VALUES (?, ?, ?, ?, ?, ?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()))
                """,
                (
                    firma_id,
                    TEST_KULLANICI["kullanici_adi"],
                    sifre_hash,
                    TEST_KULLANICI["ad_soyad"],
                    TEST_KULLANICI["email"],
                    1 if TEST_KULLANICI["is_super_admin"] else 0,
                    1 if TEST_KULLANICI["aktif"] else 0,
                ),
            )
            row = test_cursor.fetchone()
            kullanici_id = row[0] if row else None
            print(f"   - Yeni kullanıcı eklendi: {TEST_KULLANICI['kullanici_adi']} (ID: {kullanici_id})")
        
        test_conn.commit()
        
        # 6. Kullanıcıya rolleri ata
        print("\n6. Kullanıcıya rolleri atanıyor...")
        
        # Mevcut rolleri temizle
        test_cursor.execute("DELETE FROM KullaniciRolleri WHERE KullaniciId = ?", (kullanici_id,))
        
        # Tüm rolleri ata
        for rol_adi, rol_id in role_ids.items():
            if rol_id:
                test_cursor.execute(
                    """
                    INSERT INTO KullaniciRolleri (KullaniciId, RolId, OlusturmaTarihi)
                    VALUES (?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()))
                    """,
                    (kullanici_id, rol_id),
                )
                print(f"   - Rol atandı: {rol_adi}")
        
        test_conn.commit()
        
        print("\n" + "=" * 60)
        print("✅ Test veritabanı başarıyla yapılandırıldı!")
        print("=" * 60)
        print(f"\nGiriş Bilgileri:")
        print(f"  Firma Kodu: {TEST_FIRMA['kod']}")
        print(f"  Kullanıcı Adı: {TEST_KULLANICI['kullanici_adi']}")
        print(f"  Şifre: {TEST_KULLANICI['sifre']}")
        print(f"  Süper Admin: {'Evet' if TEST_KULLANICI['is_super_admin'] else 'Hayır'}")
        print(f"\nDetaylar:")
        print(f"  Firma ID: {firma_id}")
        print(f"  Kullanıcı ID: {kullanici_id}")
        print(f"  Toplam Rol: {len(role_ids)}")
        print("=" * 60)
        
        test_cursor.close()
        test_conn.close()
        
    except pyodbc.Error as e:
        print(f"\n❌ Veritabanı hatası: {e}")
        if 'test_conn' in locals():
            test_conn.rollback()
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Hata: {e}")
        import traceback
        traceback.print_exc()
        if 'test_conn' in locals():
            test_conn.rollback()
        sys.exit(1)


if __name__ == "__main__":
    response = input("\nDevam etmek istiyor musunuz? (E/H): ").strip().upper()
    if response == "E":
        setup_test_database()
    else:
        print("İşlem iptal edildi.")
