"""
Raf yönetimi endpoint'leri
"""
from typing import Any, Dict, List, Optional
from flask import request
from flask_restx import Namespace, Resource, fields
from flask_jwt_extended import jwt_required
from database import db
from middleware.auth import require_role, get_current_firma_id
from utils.responses import success_response, error_response
from utils.audit import log_action

raflar_ns = Namespace("raflar", description="Raf yönetimi")

# Request/Response modelleri
raf_create_model = raflar_ns.model(
    "RafCreate",
    {
        "raf_kodu": fields.String(required=True, description="Raf kodu (firma bazında benzersiz)"),
        "raf_adi": fields.String(required=True, description="Raf adı"),
        "raf_tipi": fields.String(
            required=False,
            description="Raf tipi (NORMAL, MAL_KABUL, CIKIS). Default: NORMAL",
            default="NORMAL",
        ),
        "aktif": fields.Boolean(required=False, description="Aktif mi? (default: true)", default=True),
    },
)

raf_update_model = raflar_ns.model(
    "RafUpdate",
    {
        "raf_kodu": fields.String(required=False, description="Raf kodu (firma bazında benzersiz)"),
        "raf_adi": fields.String(required=False, description="Raf adı"),
        "aktif": fields.Boolean(required=False, description="Aktif mi? (true/false)"),
    },
)


@raflar_ns.route("")
class Raflar(Resource):
    @jwt_required()
    @require_role("Stok Durumu")
    @raflar_ns.doc(
        description="Raf listesi (gruplandırılmış). urun_id parametresi verilirse her raf için o ürünün stok bilgisi de döner.",
        security="Bearer",
        params={
            "urun_id": {"description": "Ürün ID (opsiyonel). Verilirse her raf için o ürünün adedi döner", "type": "integer"},
        },
    )
    def get(self):
        """Firma bazlı raf listesini gruplandırılmış olarak döndürür."""
        try:
            firma_id = get_current_firma_id()
            if not firma_id:
                return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)
            
            urun_id = request.args.get("urun_id", type=int)
            
            # Ürün ID verilmişse LEFT JOIN ile stok bilgisini de al
            if urun_id:
                # Ürün kontrolü
                urun_rows = db.execute_query(
                    "SELECT Id, UrunKodu, UrunAdi FROM Urunler WHERE Id = ? AND FirmaId = ?",
                    (urun_id, firma_id),
                )
                if not urun_rows:
                    return error_response("PRODUCT_NOT_FOUND", "Ürün bulunamadı", 404)
                
                urun = urun_rows[0]
                
                # Tüm aktif rafları ve ürün stok bilgisini getir
                query = """
                    SELECT 
                        r.Id, r.FirmaId, r.RafKodu, r.RafAdi, r.RafTipi, r.Aktif, 
                        r.OlusturmaTarihi, r.GuncellemeTarihi,
                        COALESCE(rs.Adet, 0) AS UrunAdet
                    FROM Raflar r
                    LEFT JOIN RafStok rs ON r.Id = rs.RafId AND rs.UrunId = ? AND rs.FirmaId = ?
                    WHERE r.FirmaId = ? AND r.Aktif = 1
                    ORDER BY r.RafKodu ASC
                """
                raflar = db.execute_query(query, (urun_id, firma_id, firma_id))
            else:
                # Ürün ID verilmemişse sadece rafları getir
                query = """
                    SELECT Id, FirmaId, RafKodu, RafAdi, RafTipi, Aktif, 
                           OlusturmaTarihi, GuncellemeTarihi
                    FROM Raflar 
                    WHERE FirmaId = ? AND Aktif = 1
                    ORDER BY RafKodu ASC
                """
                raflar = db.execute_query(query, (firma_id,))
            
            # Tarih formatlama ve stok bilgisi ekleme
            formatted_raflar = []
            for raf in (raflar or []):
                formatted = dict(raf)
                if "OlusturmaTarihi" in formatted and formatted["OlusturmaTarihi"]:
                    if hasattr(formatted["OlusturmaTarihi"], "isoformat"):
                        formatted["OlusturmaTarihi"] = formatted["OlusturmaTarihi"].isoformat()
                if "GuncellemeTarihi" in formatted and formatted["GuncellemeTarihi"]:
                    if hasattr(formatted["GuncellemeTarihi"], "isoformat"):
                        formatted["GuncellemeTarihi"] = formatted["GuncellemeTarihi"].isoformat()
                
                # Ürün ID verilmişse stok bilgisini ekle
                if urun_id:
                    formatted["urun_adet"] = int(raf.get("UrunAdet", 0))
                
                formatted_raflar.append(formatted)
            
            # Raf tiplerine göre gruplandır
            normal_raflar = []
            mal_kabul_raflar = []
            cikis_raflar = []
            
            for raf in formatted_raflar:
                raf_tipi = (raf.get("RafTipi") or "NORMAL").strip().upper()
                if raf_tipi == "MAL_KABUL":
                    mal_kabul_raflar.append(raf)
                elif raf_tipi == "CIKIS":
                    cikis_raflar.append(raf)
                else:
                    normal_raflar.append(raf)
            
            response_data = {
                "normal": normal_raflar,
                "mal_kabul": mal_kabul_raflar,
                "cikis": cikis_raflar,
                "tum_raflar": formatted_raflar,
            }
            
            # Ürün ID verilmişse ürün bilgisini de ekle
            if urun_id:
                response_data["urun"] = {
                    "id": urun["Id"],
                    "urun_kodu": urun["UrunKodu"],
                    "urun_adi": urun["UrunAdi"],
                }
            
            return success_response(response_data, status_code=200)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)

    @jwt_required()
    @require_role("Raf Yönetimi")
    @raflar_ns.expect(raf_create_model, validate=True)
    @raflar_ns.doc(description="Yeni raf ekler", security="Bearer")
    def post(self):
        """Yeni raf ekler (Raf Yönetimi rolü)."""
        body = request.get_json() or {}
        raf_kodu = (body.get("raf_kodu") or "").strip()
        raf_adi = (body.get("raf_adi") or "").strip()
        raf_tipi = (body.get("raf_tipi") or "NORMAL").strip().upper()
        aktif = body.get("aktif", True)
        
        if not raf_kodu or not raf_adi:
            return error_response(
                "VALIDATION_ERROR",
                "raf_kodu ve raf_adi alanları zorunludur",
                400,
            )
        
        # Raf tipi validasyonu
        if raf_tipi not in ["NORMAL", "MAL_KABUL", "CIKIS"]:
            return error_response(
                "VALIDATION_ERROR",
                "raf_tipi geçerli bir değer olmalıdır (NORMAL, MAL_KABUL, CIKIS)",
                400,
            )
        
        firma_id = get_current_firma_id()
        if not firma_id:
            return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)
        
        try:
            # Duplicate kontrol (firma bazında, aktif raflar arasında)
            exists = db.execute_query(
                """
                SELECT COUNT(*) AS Sayi FROM Raflar
                WHERE FirmaId = ? AND RafKodu = ? AND Aktif = 1
                """,
                (firma_id, raf_kodu),
            )
            if exists and exists[0].get("Sayi", 0) > 0:
                return error_response(
                    "DUPLICATE_RAF",
                    "Bu raf kodu zaten kullanılıyor",
                    400,
                )
            
            # Birden fazla MAL_KABUL ve CIKIS rafı oluşturulabilir
            # Giriş/çıkış işlemlerinde kontrol yapılacak
            
            # Raf ekle
            conn = db.get_connection()
            cursor = conn.cursor()
            insert_sql = """
                INSERT INTO Raflar (FirmaId, RafKodu, RafAdi, RafTipi, Aktif, OlusturmaTarihi)
                OUTPUT INSERTED.Id, INSERTED.FirmaId, INSERTED.RafKodu, INSERTED.RafAdi, 
                       INSERTED.RafTipi, INSERTED.Aktif, INSERTED.OlusturmaTarihi, INSERTED.GuncellemeTarihi
                VALUES (?, ?, ?, ?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()))
            """
            cursor.execute(
                insert_sql,
                (firma_id, raf_kodu, raf_adi, raf_tipi, 1 if bool(aktif) else 0),
            )
            row = cursor.fetchone()
            conn.commit()
            cursor.close()
            
            # Response hazırla
            created_raf = {
                "Id": row[0],
                "FirmaId": row[1],
                "RafKodu": row[2],
                "RafAdi": row[3],
                "RafTipi": row[4],
                "Aktif": bool(row[5]),
                "OlusturmaTarihi": row[6].isoformat() if hasattr(row[6], "isoformat") else row[6],
                "GuncellemeTarihi": row[7].isoformat() if row[7] and hasattr(row[7], "isoformat") else row[7],
            }
            
            # Audit log
            log_action(
                "raf_ekleme",
                f"Yeni raf eklendi: {raf_kodu}",
                urun_id=None,
                yeni_deger=created_raf,
            )
            
            return success_response(created_raf, "Raf başarıyla eklendi", 201)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)


@raflar_ns.route("/<int:raf_id>")
class Raf(Resource):
    @jwt_required()
    @require_role("Raf Yönetimi")
    @raflar_ns.expect(raf_update_model, validate=False)
    @raflar_ns.doc(description="Raf bilgilerini günceller", security="Bearer")
    def put(self, raf_id: int):
        """Raf bilgilerini günceller (Raf Yönetimi rolü)."""
        body = request.get_json() or {}
        raf_kodu = body.get("raf_kodu")
        raf_adi = body.get("raf_adi")
        aktif = body.get("aktif")
        
        # En az bir alan gönderilmeli
        if all(v is None for v in [raf_kodu, raf_adi, aktif]):
            return error_response(
                "VALIDATION_ERROR",
                "Güncellenecek en az bir alan gönderilmelidir",
                400,
            )
        
        firma_id = get_current_firma_id()
        if not firma_id:
            return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)
        
        try:
            # Mevcut rafı kontrol et
            mevcut_rows = db.execute_query(
                "SELECT * FROM Raflar WHERE Id = ? AND FirmaId = ?",
                (raf_id, firma_id),
            )
            if not mevcut_rows:
                return error_response("NOT_FOUND", "Raf bulunamadı", 404)
            
            mevcut = mevcut_rows[0]
            eski_aktif = bool(mevcut.get("Aktif", 0))
            
            # Pasife alınacaksa stok kontrolü yap
            if aktif is not None and not bool(aktif) and eski_aktif:
                # Raf'ta ürün var mı kontrol et
                stok_rows = db.execute_query(
                    """
                    SELECT SUM(Adet) AS ToplamAdet
                    FROM RafStok
                    WHERE RafId = ? AND FirmaId = ?
                    """,
                    (raf_id, firma_id),
                )
                toplam_adet = 0
                if stok_rows and stok_rows[0].get("ToplamAdet") is not None:
                    toplam_adet = int(stok_rows[0].get("ToplamAdet", 0))
                
                if toplam_adet > 0:
                    return error_response(
                        "CANNOT_DEACTIVATE_RAF",
                        f"Raf pasife alınamaz. Raf'ta {toplam_adet} adet ürün bulunmaktadır. Lütfen önce ürünleri başka rafa transfer edin.",
                        400,
                    )
            
            # Duplicate kontrol (raf_kodu güncelleniyorsa)
            if raf_kodu is not None:
                raf_kodu = str(raf_kodu).strip()
                if not raf_kodu:
                    return error_response("VALIDATION_ERROR", "raf_kodu boş olamaz", 400)
                
                # Aynı firma içinde başka bir raf aynı kodu kullanıyor mu? (kendisi hariç)
                exists = db.execute_query(
                    """
                    SELECT COUNT(*) AS Sayi FROM Raflar
                    WHERE FirmaId = ? AND RafKodu = ? AND Id <> ? AND Aktif = 1
                    """,
                    (firma_id, raf_kodu, raf_id),
                )
                if exists and exists[0].get("Sayi", 0) > 0:
                    return error_response(
                        "DUPLICATE_RAF",
                        "Bu raf kodu zaten başka bir raf tarafından kullanılıyor",
                        400,
                    )
            
            # Güncelleme SQL'i oluştur
            set_parts = []
            params = []
            
            if raf_kodu is not None:
                set_parts.append("RafKodu = ?")
                params.append(str(raf_kodu).strip())
            
            if raf_adi is not None:
                raf_adi = str(raf_adi).strip()
                if not raf_adi:
                    return error_response("VALIDATION_ERROR", "raf_adi boş olamaz", 400)
                set_parts.append("RafAdi = ?")
                params.append(raf_adi)
            
            if aktif is not None:
                set_parts.append("Aktif = ?")
                params.append(1 if bool(aktif) else 0)
            
            set_parts.append("GuncellemeTarihi = DATEADD(HOUR, 3, SYSUTCDATETIME())")
            
            # UPDATE sorgusu
            update_sql = "UPDATE Raflar SET " + ", ".join(set_parts) + " WHERE Id = ? AND FirmaId = ?"
            params.extend([raf_id, firma_id])
            
            db.execute_query(update_sql, tuple(params), fetch=False)
            
            # Güncellenmiş rafı getir
            guncellenmis_rows = db.execute_query(
                """
                SELECT Id, FirmaId, RafKodu, RafAdi, RafTipi, Aktif, 
                       OlusturmaTarihi, GuncellemeTarihi
                FROM Raflar
                WHERE Id = ? AND FirmaId = ?
                """,
                (raf_id, firma_id),
            )
            
            if not guncellenmis_rows:
                return error_response("INTERNAL_SERVER_ERROR", "Raf güncellenemedi", 500)
            
            guncellenmis = guncellenmis_rows[0]
            
            # Tarih formatlama
            formatted_raf = dict(guncellenmis)
            if "OlusturmaTarihi" in formatted_raf and formatted_raf["OlusturmaTarihi"]:
                if hasattr(formatted_raf["OlusturmaTarihi"], "isoformat"):
                    formatted_raf["OlusturmaTarihi"] = formatted_raf["OlusturmaTarihi"].isoformat()
            if "GuncellemeTarihi" in formatted_raf and formatted_raf["GuncellemeTarihi"]:
                if hasattr(formatted_raf["GuncellemeTarihi"], "isoformat"):
                    formatted_raf["GuncellemeTarihi"] = formatted_raf["GuncellemeTarihi"].isoformat()
            
            # Güncellenen alanları tespit et
            updated_fields = []
            if raf_kodu is not None and mevcut.get("RafKodu") != formatted_raf.get("RafKodu"):
                updated_fields.append("Raf Kodu")
            if raf_adi is not None and mevcut.get("RafAdi") != formatted_raf.get("RafAdi"):
                updated_fields.append("Raf Adı")
            if aktif is not None and eski_aktif != bool(formatted_raf.get("Aktif", 0)):
                updated_fields.append("Aktif Durumu")
            
            # Audit log
            if updated_fields:
                if len(updated_fields) == 1:
                    aciklama = f"{updated_fields[0]} güncellendi"
                else:
                    aciklama = f"{', '.join(updated_fields)} güncellendi"
            else:
                aciklama = f"Raf güncellendi: {mevcut.get('RafKodu')}"
            
            log_action(
                "raf_guncelleme",
                aciklama,
                urun_id=None,
                eski_deger=mevcut,
                yeni_deger=formatted_raf,
            )
            
            return success_response(formatted_raf, "Raf başarıyla güncellendi", 200)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)


@raflar_ns.route("/<int:raf_id>/stok")
class RafStok(Resource):
    @jwt_required()
    @require_role("Stok Durumu")
    @raflar_ns.doc(
        description="Raf stok durumu",
        security="Bearer",
        params={
            "urun_id": {"description": "Ürün ID filtresi (opsiyonel)", "type": "integer"},
        },
    )
    def get(self, raf_id: int):
        """Belirli raftaki ürünlerin stok durumunu döndürür."""
        try:
            firma_id = get_current_firma_id()
            if not firma_id:
                return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)
            
            # Raf kontrolü
            raf_rows = db.execute_query(
                "SELECT * FROM Raflar WHERE Id = ? AND FirmaId = ? AND Aktif = 1",
                (raf_id, firma_id),
            )
            if not raf_rows:
                return error_response("NOT_FOUND", "Raf bulunamadı", 404)
            
            raf = raf_rows[0]
            urun_id = request.args.get("urun_id", type=int)
            
            if urun_id:
                # Sadece belirli ürün
                query = """
                    SELECT 
                        rs.Id,
                        rs.RafId,
                        rs.UrunId,
                        rs.Adet,
                        rs.GuncellemeTarihi,
                        u.UrunKodu,
                        u.UrunAdi,
                        u.Barkod
                    FROM RafStok rs
                    INNER JOIN Urunler u ON rs.UrunId = u.Id
                    WHERE rs.RafId = ? AND rs.UrunId = ? AND rs.FirmaId = ?
                """
                stok_rows = db.execute_query(query, (raf_id, urun_id, firma_id))
            else:
                # Tüm ürünler
                query = """
                    SELECT 
                        rs.Id,
                        rs.RafId,
                        rs.UrunId,
                        rs.Adet,
                        rs.GuncellemeTarihi,
                        u.UrunKodu,
                        u.UrunAdi,
                        u.Barkod
                    FROM RafStok rs
                    INNER JOIN Urunler u ON rs.UrunId = u.Id
                    WHERE rs.RafId = ? AND rs.FirmaId = ?
                    ORDER BY u.UrunAdi ASC
                """
                stok_rows = db.execute_query(query, (raf_id, firma_id))
            
            # Formatlama
            formatted_stok = []
            for stok in (stok_rows or []):
                formatted = dict(stok)
                if "GuncellemeTarihi" in formatted and formatted["GuncellemeTarihi"]:
                    if hasattr(formatted["GuncellemeTarihi"], "isoformat"):
                        formatted["GuncellemeTarihi"] = formatted["GuncellemeTarihi"].isoformat()
                formatted_stok.append(formatted)
            
            return success_response({
                "raf": {
                    "id": raf["Id"],
                    "raf_kodu": raf["RafKodu"],
                    "raf_adi": raf["RafAdi"],
                    "raf_tipi": raf["RafTipi"],
                },
                "stok": formatted_stok,
            }, status_code=200)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)
