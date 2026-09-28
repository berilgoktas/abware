"""
Dashboard routes
"""
from flask import request
from flask_restx import Namespace, Resource
from flask_jwt_extended import jwt_required

from database import db
from utils.responses import success_response, error_response
from middleware.auth import require_role, get_current_firma_id
from utils.pagination import parse_limit

dashboard_ns = Namespace('dashboard', description='Dashboard işlemleri')


def _format_islem_tipi_for_display(value: str) -> str:
    """Görsel gösterim için "giris"/"cikis" → "Giriş"/"Çıkış" dönüştürür."""
    if not value:
        return value
    normalized = str(value).strip().lower()
    if normalized == "giris":
        return "Giriş"
    if normalized == "cikis":
        return "Çıkış"
    # Zaten "Giriş"/"Çıkış" formatındaysa olduğu gibi döndür
    return value


def _format_aciklama_for_display(aciklama: str | None) -> str | None:
    """Aciklama içindeki "giris"/"cikis" kelimelerini "Giriş"/"Çıkış" olarak değiştirir."""
    if not aciklama:
        return aciklama
    text = str(aciklama)
    # "giris" → "Giriş", "cikis" → "Çıkış" (case-insensitive)
    text = text.replace("giris", "Giriş").replace("Giris", "Giriş").replace("GIRIS", "Giriş")
    text = text.replace("cikis", "Çıkış").replace("Cikis", "Çıkış").replace("CIKIS", "Çıkış")
    return text


@dashboard_ns.route('/stats')
class Stats(Resource):
    @jwt_required()
    @require_role('Kontrol Paneli')
    @dashboard_ns.doc(description='Dashboard istatistikleri', security='Bearer')
    def get(self):
        """Dashboard istatistikleri"""
        try:
            firma_id = get_current_firma_id()
            if not firma_id:
                return error_response('UNAUTHORIZED', 'Geçersiz firma bilgisi', status_code=401)
            # Toplam ürün sayısı
            query1 = "SELECT COUNT(*) as ToplamUrun FROM Urunler WHERE FirmaId = ? AND Aktif = 1"
            toplam_urun = db.execute_query(query1, (firma_id,))[0]['ToplamUrun']
            
            # Kritik stok sayısı
            query2 = """
                SELECT COUNT(*) as KritikStokSayisi 
                FROM Urunler 
                WHERE FirmaId = ? AND Aktif = 1 AND ReelStok <= KritikStok
            """
            kritik_stok = db.execute_query(query2, (firma_id,))[0]['KritikStokSayisi']
            
            # Bugünkü giriş/çıkış
            query3 = """
                SELECT 
                    SUM(CASE WHEN IslemTipi = 'giris' THEN 1 ELSE 0 END) as BugunGiris,
                    SUM(CASE WHEN IslemTipi = 'cikis' THEN 1 ELSE 0 END) as BugunCikis
                FROM StokIslemleri
                WHERE FirmaId = ? AND CONVERT(date, Tarih) = CONVERT(date, DATEADD(HOUR, 3, SYSUTCDATETIME()))
            """
            bugun = db.execute_query(query3, (firma_id,))[0]
            
            data = {
                'toplam_urun': toplam_urun,
                'kritik_stok_sayisi': kritik_stok,
                'bugun_giris': bugun['BugunGiris'] or 0,
                'bugun_cikis': bugun['BugunCikis'] or 0,
                'toplam_stok_degeri': 0  # Gelecekte hesaplanacak
            }
            
            return success_response(data, status_code=200)
        except Exception as e:
            return error_response('INTERNAL_SERVER_ERROR', str(e), status_code=500)


@dashboard_ns.route('/critical-stocks')
class CriticalStocks(Resource):
    @jwt_required()
    @require_role('Kontrol Paneli')
    @dashboard_ns.doc(
        description='Kritik stok listesi',
        security='Bearer',
        params={
            "limit": {"description": "Kaç kayıt gelsin? (default 20, max 5000)", "type": "integer", "default": 20},
        },
    )
    def get(self):
        """Kritik stok listesi"""
        try:
            firma_id = get_current_firma_id()
            if not firma_id:
                return error_response('UNAUTHORIZED', 'Geçersiz firma bilgisi', status_code=401)

            limit = parse_limit(request.args, default_limit=20, max_limit=5000)

            query = """
                SELECT TOP (?)
                    Id,
                    UrunKodu,
                    UrunAdi,
                    ReelStok,
                    KritikStok,
                    CASE 
                        WHEN ReelStok <= KritikStok THEN 'kritik'
                        ELSE 'normal'
                    END as Durum
                FROM Urunler
                WHERE FirmaId = ? AND ReelStok <= KritikStok
                ORDER BY ReelStok ASC
            """
            urunler = db.execute_query(query, (limit, firma_id))
            
            data = {
                'urunler': urunler,
                'sayfalama': {"limit": limit, "donen": len(urunler)},
            }
            
            return success_response(data, status_code=200)
        except Exception as e:
            return error_response('INTERNAL_SERVER_ERROR', str(e), status_code=500)


@dashboard_ns.route('/recent-activities')
class RecentActivities(Resource):
    @jwt_required()
    @require_role('Kontrol Paneli')
    @dashboard_ns.doc(
        description='Son işlemler',
        security='Bearer',
        params={
            "period": {"description": "daily|monthly|yearly (default: daily)", "type": "string", "default": "daily"},
            "limit": {"description": "Kaç kayıt gelsin? (default 10, max 100)", "type": "integer", "default": 10},
        },
    )
    def get(self):
        """Son işlemler"""
        try:
            firma_id = get_current_firma_id()
            if not firma_id:
                return error_response('UNAUTHORIZED', 'Geçersiz firma bilgisi', status_code=401)
            period = (request.args.get("period") or "daily").strip().lower()
            limit = parse_limit(request.args, default_limit=10, max_limit=100)

            if period == "yearly":
                date_filter = "AND ig.Tarih >= DATEADD(year, -1, DATEADD(HOUR, 3, SYSUTCDATETIME()))"
            elif period == "monthly":
                date_filter = "AND ig.Tarih >= DATEADD(month, -1, DATEADD(HOUR, 3, SYSUTCDATETIME()))"
            else:  # daily default
                date_filter = "AND ig.Tarih >= DATEADD(day, -1, DATEADD(HOUR, 3, SYSUTCDATETIME()))"

            query = """
                SELECT TOP (?)
                    ig.Id,
                    ig.IslemTipi,
                    ig.Aciklama,
                    ig.Tarih,
                    k.AdSoyad as KullaniciAdSoyad,
                    u.UrunKodu,
                    u.UrunAdi
                FROM IslemGecmisi ig
                LEFT JOIN Kullanicilar k ON ig.KullaniciId = k.Id
                LEFT JOIN Urunler u ON ig.UrunId = u.Id
                WHERE ig.FirmaId = ?
                """ + f"""
                {date_filter}
                ORDER BY ig.Tarih DESC
            """
            aktiviteler_raw = db.execute_query(query, (limit, firma_id))
            
            # Görsel formatlama: IslemTipi ve Aciklama alanlarını dönüştür
            aktiviteler = []
            for aktivite in (aktiviteler_raw or []):
                formatted = dict(aktivite)
                if "IslemTipi" in formatted:
                    # IslemTipi "stok_hareket" gibi değerler olabilir, sadece "giris"/"cikis" ise formatla
                    islem_tipi_val = formatted.get("IslemTipi", "")
                    if islem_tipi_val in ("giris", "cikis", "Giriş", "Çıkış"):
                        formatted["IslemTipi"] = _format_islem_tipi_for_display(islem_tipi_val)
                if "Aciklama" in formatted:
                    formatted["Aciklama"] = _format_aciklama_for_display(formatted.get("Aciklama"))
                aktiviteler.append(formatted)
            
            data = {
                'aktiviteler': aktiviteler,
                'period': period,
                'sayfalama': {"limit": limit, "donen": len(aktiviteler)},
            }
            
            return success_response(data, status_code=200)
        except Exception as e:
            return error_response('INTERNAL_SERVER_ERROR', str(e), status_code=500)


@dashboard_ns.route('/today-transactions')
class TodayTransactions(Resource):
    @jwt_required()
    @require_role('Kontrol Paneli')
    @dashboard_ns.doc(description='Bugünkü işlemler', security='Bearer')
    def get(self):
        """Bugünkü giriş/çıkış istatistikleri"""
        try:
            firma_id = get_current_firma_id()
            if not firma_id:
                return error_response('UNAUTHORIZED', 'Geçersiz firma bilgisi', status_code=401)
            query = """
                SELECT 
                    CONVERT(date, DATEADD(HOUR, 3, SYSUTCDATETIME())) as Bugun,
                    SUM(CASE WHEN IslemTipi = 'giris' THEN 1 ELSE 0 END) as GirisAdet,
                    SUM(CASE WHEN IslemTipi = 'giris' THEN Miktar ELSE 0 END) as GirisToplamMiktar,
                    COUNT(DISTINCT CASE WHEN IslemTipi = 'giris' THEN UrunId END) as GirisUrunSayisi,
                    SUM(CASE WHEN IslemTipi = 'cikis' THEN 1 ELSE 0 END) as CikisAdet,
                    SUM(CASE WHEN IslemTipi = 'cikis' THEN Miktar ELSE 0 END) as CikisToplamMiktar,
                    COUNT(DISTINCT CASE WHEN IslemTipi = 'cikis' THEN UrunId END) as CikisUrunSayisi
                FROM StokIslemleri
                WHERE FirmaId = ? AND CONVERT(date, Tarih) = CONVERT(date, DATEADD(HOUR, 3, SYSUTCDATETIME()))
            """
            result = db.execute_query(query, (firma_id,))[0]
            
            data = {
                'bugun': str(result['Bugun']),
                'giris': {
                    'adet': result['GirisAdet'] or 0,
                    'toplam_miktar': result['GirisToplamMiktar'] or 0,
                    'urun_sayisi': result['GirisUrunSayisi'] or 0
                },
                'cikis': {
                    'adet': result['CikisAdet'] or 0,
                    'toplam_miktar': result['CikisToplamMiktar'] or 0,
                    'urun_sayisi': result['CikisUrunSayisi'] or 0
                }
            }
            
            return success_response(data, status_code=200)
        except Exception as e:
            return error_response('INTERNAL_SERVER_ERROR', str(e), status_code=500)

