"""
Raf işlemleri için helper fonksiyonlar
"""
from typing import Optional, Dict, Any, Tuple
from database import db
from middleware.auth import get_current_firma_id
from flask import current_app


def find_raf_by_barkod(raf_barkodu: str) -> Optional[Dict[str, Any]]:
    """Raf barkodu ile rafı bulur."""
    if not raf_barkodu:
        return None
    
    firma_id = get_current_firma_id()
    if not firma_id:
        return None
    
    rows = db.execute_query(
        "SELECT * FROM Raflar WHERE RafKodu = ? AND FirmaId = ? AND Aktif = 1",
        (raf_barkodu.strip(), firma_id),
    )
    
    return rows[0] if rows else None


def find_raf_by_tip(raf_tipi: str) -> Optional[Dict[str, Any]]:
    """Raf tipi ile rafı bulur (örn: MAL_KABUL, CIKIS). ORDER BY Id ile ilk rafı döndürür."""
    if not raf_tipi:
        return None
    
    firma_id = get_current_firma_id()
    if not firma_id:
        return None
    
    rows = db.execute_query(
        "SELECT TOP 1 * FROM Raflar WHERE RafTipi = ? AND FirmaId = ? AND Aktif = 1 ORDER BY Id ASC",
        (raf_tipi, firma_id),
    )
    
    return rows[0] if rows else None


def count_raflar_by_tip(raf_tipi: str) -> int:
    """Belirli tipte kaç aktif raf olduğunu döndürür."""
    if not raf_tipi:
        return 0
    
    firma_id = get_current_firma_id()
    if not firma_id:
        return 0
    
    rows = db.execute_query(
        "SELECT COUNT(*) AS Sayi FROM Raflar WHERE RafTipi = ? AND FirmaId = ? AND Aktif = 1",
        (raf_tipi, firma_id),
    )
    
    return int(rows[0].get("Sayi", 0)) if rows else 0


def get_raf_stok(raf_id: int, urun_id: int) -> int:
    """Belirli raftaki ürün adedini döndürür."""
    firma_id = get_current_firma_id()
    if not firma_id:
        return 0
    
    rows = db.execute_query(
        "SELECT Adet FROM RafStok WHERE RafId = ? AND UrunId = ? AND FirmaId = ?",
        (raf_id, urun_id, firma_id),
    )
    
    if rows:
        return int(rows[0].get("Adet", 0))
    return 0


def update_raf_stok(raf_id: int, urun_id: int, adet_delta: int) -> Tuple[int, int]:
    """
    Raf stokunu günceller (artırır veya azaltır).
    
    Returns:
        (onceki_adet, yeni_adet)
    """
    firma_id = get_current_firma_id()
    if not firma_id:
        raise RuntimeError("Geçersiz firma bilgisi")
    
    conn = db.get_connection()
    cursor = conn.cursor()
    
    try:
        # Mevcut stoku kontrol et
        current_rows = db.execute_query(
            "SELECT Adet FROM RafStok WHERE RafId = ? AND UrunId = ? AND FirmaId = ?",
            (raf_id, urun_id, firma_id),
        )
        
        if current_rows:
            onceki_adet = int(current_rows[0].get("Adet", 0))
            yeni_adet = onceki_adet + adet_delta
            
            if yeni_adet < 0:
                raise RuntimeError(f"Yetersiz raf stoku. Mevcut: {onceki_adet}, İstenen çıkış: {abs(adet_delta)}")
            
            # Güncelle
            cursor.execute(
                """
                UPDATE RafStok 
                SET Adet = ?, GuncellemeTarihi = DATEADD(HOUR, 3, SYSUTCDATETIME())
                WHERE RafId = ? AND UrunId = ? AND FirmaId = ?
                """,
                (yeni_adet, raf_id, urun_id, firma_id),
            )
            
            # Eğer stok 0 olduysa kaydı sil (opsiyonel - veya 0 olarak bırakılabilir)
            if yeni_adet == 0:
                cursor.execute(
                    "DELETE FROM RafStok WHERE RafId = ? AND UrunId = ? AND FirmaId = ?",
                    (raf_id, urun_id, firma_id),
                )
        else:
            # Kayıt yoksa ve adet_delta pozitifse yeni kayıt oluştur
            if adet_delta > 0:
                onceki_adet = 0
                yeni_adet = adet_delta
                cursor.execute(
                    """
                    INSERT INTO RafStok (FirmaId, RafId, UrunId, Adet, GuncellemeTarihi)
                    VALUES (?, ?, ?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()))
                    """,
                    (firma_id, raf_id, urun_id, adet_delta),
                )
            else:
                raise RuntimeError(f"Raf stok kaydı bulunamadı ve negatif delta verilemez")
        
        conn.commit()
        return (onceki_adet, yeni_adet)
    
    except Exception as e:
        conn.rollback()
        raise
    finally:
        cursor.close()


def create_raf_hareket(
    stok_islemi_id: Optional[int],
    kaynak_raf_id: Optional[int],
    hedef_raf_id: Optional[int],
    urun_id: int,
    miktar: int,
    islem_tipi: str,
    kullanici_id: int,
    aciklama: Optional[str] = None,
) -> Dict[str, Any]:
    """
    RafHareketleri tablosuna kayıt ekler.
    
    Returns:
        Oluşturulan hareket kaydı
    """
    firma_id = get_current_firma_id()
    if not firma_id:
        raise RuntimeError("Geçersiz firma bilgisi")
    
    conn = db.get_connection()
    cursor = conn.cursor()
    
    try:
        insert_sql = """
            INSERT INTO RafHareketleri (
                FirmaId, StokIslemiId, KaynakRafId, HedefRafId, UrunId, 
                Miktar, IslemTipi, KullaniciId, Tarih, Aciklama
            )
            OUTPUT INSERTED.Id, INSERTED.FirmaId, INSERTED.StokIslemiId, 
                   INSERTED.KaynakRafId, INSERTED.HedefRafId, INSERTED.UrunId,
                   INSERTED.Miktar, INSERTED.IslemTipi, INSERTED.KullaniciId, 
                   INSERTED.Tarih, INSERTED.Aciklama
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()), ?)
        """
        
        cursor.execute(
            insert_sql,
            (
                firma_id,
                stok_islemi_id,
                kaynak_raf_id,
                hedef_raf_id,
                urun_id,
                miktar,
                islem_tipi,
                kullanici_id,
                aciklama,
            ),
        )
        
        row = cursor.fetchone()
        conn.commit()
        
        hareket_dict = {
            "Id": row[0],
            "FirmaId": row[1],
            "StokIslemiId": row[2],
            "KaynakRafId": row[3],
            "HedefRafId": row[4],
            "UrunId": row[5],
            "Miktar": row[6],
            "IslemTipi": row[7],
            "KullaniciId": row[8],
            "Tarih": row[9].isoformat() if hasattr(row[9], "isoformat") else row[9],
            "Aciklama": row[10],
        }
        
        return hareket_dict
    
    except Exception as e:
        conn.rollback()
        raise
    finally:
        cursor.close()


def get_mal_kabul_rafi(raf_barkodu: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Mal kabul rafını döndürür.
    
    Args:
        raf_barkodu: Eğer belirtilirse, o barkodlu rafı bulur.
                     Belirtilmezse önce config'deki kodu, sonra tip ile arar.
    
    Returns:
        Mal kabul rafı veya None
    """
    if raf_barkodu:
        return find_raf_by_barkod(raf_barkodu)
    
    from flask import current_app
    raf_kodu = current_app.config.get('MAL_KABUL_RAF_KODU', 'MAL-KABUL')
    return find_raf_by_barkod(raf_kodu) or find_raf_by_tip('MAL_KABUL')


def get_cikis_rafi(raf_barkodu: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Çıkış rafını döndürür.
    
    Args:
        raf_barkodu: Eğer belirtilirse, o barkodlu rafı bulur.
                     Belirtilmezse önce config'deki kodu, sonra tip ile arar.
    
    Returns:
        Çıkış rafı veya None
    """
    if raf_barkodu:
        return find_raf_by_barkod(raf_barkodu)
    
    from flask import current_app
    raf_kodu = current_app.config.get('CIKIS_RAF_KODU', 'CIKIS')
    return find_raf_by_barkod(raf_kodu) or find_raf_by_tip('CIKIS')
