"""
Ürün listeleme ve ürün yönetimi endpoint'leri.
"""

from typing import Any, Dict, List, Optional

from decimal import Decimal, InvalidOperation

from flask import request
from flask_restx import Namespace, Resource, fields
from flask_jwt_extended import jwt_required, get_jwt
import pyodbc

from database import db
from middleware.auth import require_role, get_current_firma_id
from utils.responses import success_response, error_response
from utils.audit import log_action
from utils.fx import get_eur_try_rate, tl_to_eur
from utils.pagination import parse_limit
import json


products_ns = Namespace("products", description="Ürün yönetimi")


# Alan isimleri mapping (Türkçe gösterim için)
_ALAN_ISIMLERI = {
    "UrunKodu": "Ürün kodu",
    "UrunAdi": "Ürün adı",
    "Barkod": "Barkod",
    "KritikStok": "Kritik stok",
    "FiyatTL": "Fiyat",  # FiyatTL ve FiyatEUR birlikte "Fiyat" olarak gösterilecek
    "FiyatEUR": "Fiyat",  # Aynı grup
    "AdetTuru": "Adet türü",
    "Aciklama": "Açıklama",
}


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


def _parse_limit_no_max(args, default_limit: int = 50) -> int:
    """Limit parametresini parse eder, max limit kısıtlaması yok."""
    limit_raw = args.get("limit", default_limit)
    try:
        limit = int(limit_raw)
    except Exception:
        limit = default_limit
    return max(1, limit)  # Sadece minimum 1 kontrolü

def _parse_bool(value) -> bool | None:
    """
    JSON boolean bazen istemcilerde string/int gelebiliyor.
    True/False yanında: "true"/"false", "1"/"0", 1/0 destekler.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(int(value))
    s = str(value).strip().lower()
    if s in {"true", "1", "yes", "y", "on"}:
        return True
    if s in {"false", "0", "no", "n", "off"}:
        return False
    return None


# ------- Şema tanımları -------

product_create_model = products_ns.model(
    "ProductCreate",
    {
        "urun_kodu": fields.String(required=True, description="Ürün kodu"),
        "urun_adi": fields.String(required=True, description="Ürün adı"),
        "barkod": fields.String(required=True, description="Ürün barkodu"),
        "kritik_stok": fields.Integer(required=True, description="Kritik stok"),
        "fiyat_tl": fields.Float(required=False, description="Ürün birim fiyatı (TL)"),
        "adet_turu": fields.String(
            required=False,
            description="Adet/miktar türü (serbest metin). Örn: adet, koli, paket, kg",
        ),
        "aciklama": fields.String(required=False, description="Açıklama"),
        "aktif": fields.Boolean(required=False, description="Aktif mi? (default: true)", default=True),
    },
)

product_update_model = products_ns.model(
    "ProductUpdate",
    {
        "urun_kodu": fields.String(required=False, description="Ürün kodu"),
        "urun_adi": fields.String(required=False, description="Ürün adı"),
        "barkod": fields.String(required=False, description="Ürün barkodu"),
        "kritik_stok": fields.Integer(required=False, description="Kritik stok"),
        "fiyat_tl": fields.Float(required=False, description="Ürün birim fiyatı (TL)"),
        "adet_turu": fields.String(
            required=False,
            description="Adet/miktar türü (serbest metin). Örn: adet, koli, paket, kg",
        ),
        "aciklama": fields.String(required=False, description="Açıklama"),
    },
)

product_status_model = products_ns.model(
    "ProductStatus",
    {
        "aktif": fields.Boolean(required=True, description="Aktif mi? (true/false)"),
    },
)


def _get_product_by_id(urun_id: int) -> Optional[Dict[str, Any]]:
    firma_id = get_current_firma_id()
    if not firma_id:
        return None
    rows = db.execute_query(
        "SELECT * FROM Urunler WHERE Id = ? AND FirmaId = ?",
        (urun_id, firma_id),
    )
    return rows[0] if rows else None


def _detect_updated_fields(eski: Dict[str, Any], yeni: Dict[str, Any]) -> List[str]:
    """Güncellenen alanları tespit eder ve Türkçe alan isimlerini döndürür."""
    updated_fields = []
    
    # Karşılaştırılacak alanlar
    fields_to_check = [
        ("UrunKodu", "Ürün kodu"),
        ("UrunAdi", "Ürün adı"),
        ("Barkod", "Barkod"),
        ("KritikStok", "Kritik stok"),
        ("AdetTuru", "Adet türü"),
        ("Aciklama", "Açıklama"),
    ]
    
    for db_field, display_name in fields_to_check:
        if eski.get(db_field) != yeni.get(db_field):
            updated_fields.append(display_name)
    
    # Fiyat kontrolü (FiyatTL veya FiyatEUR değişmişse "Fiyat" ekle)
    if eski.get("FiyatTL") != yeni.get("FiyatTL") or eski.get("FiyatEUR") != yeni.get("FiyatEUR"):
        if "Fiyat" not in updated_fields:
            updated_fields.append("Fiyat")
    
    return updated_fields


@products_ns.route("")
class Products(Resource):
    @jwt_required()
    @products_ns.doc(
        description="Ürün listesi",
        security="Bearer",
        params={
            "aktif": {"description": "Filtre: 1|0|all (default: all)", "type": "string"},
            "limit": {"description": "Kaç kayıt gelsin? (default 100, max 5000)", "type": "integer", "default": 100},
        },
    )
    def get(self):
        """Ürün listesini döndürür."""
        try:
            firma_id = get_current_firma_id()
            if not firma_id:
                return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)
            aktif_q = (request.args.get("aktif") or "all").strip().lower()
            limit = parse_limit(request.args, default_limit=100, max_limit=5000)
            # Varsayılan: tüm ürünler (aktif + pasif)
            where = "FirmaId = ?"
            params: List[Any] = [firma_id]
            if aktif_q in ("all", "hepsi"):
                pass
            elif aktif_q in ("0", "false", "pasif"):
                where += " AND Aktif = 0"
            else:
                where += " AND Aktif = 1"

            rows: List[Dict[str, Any]] = db.execute_query(
                f"SELECT TOP (?) * FROM Urunler WHERE {where} ORDER BY UrunAdi",
                tuple([limit] + params),
            )
            
            # Fiyat bilgilerini kontrol et: "Stok Durum Fiyat" rolü yoksa fiyat bilgilerini çıkar
            claims = get_jwt()
            user_roles = claims.get("roller", []) if claims else []
            # Rolleri normalize et (case-insensitive, strip whitespace)
            user_roles_normalized = [str(r).strip() for r in user_roles if r]
            has_price_permission = "Stok Durum Fiyat" in user_roles_normalized
            
            if not has_price_permission:
                # Fiyat bilgilerini response'dan çıkar
                for urun in rows:
                    urun.pop("FiyatTL", None)
                    urun.pop("FiyatEUR", None)
                    urun.pop("KurEURTRY", None)
                    urun.pop("KurTarihi", None)
            
            data = {
                "urunler": rows,
                "sayfalama": {"limit": limit, "donen": len(rows)},
            }
            return success_response(data, status_code=200)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)

    @jwt_required()
    @require_role("Ürün Ekle")
    @products_ns.expect(product_create_model, validate=True)
    @products_ns.doc(description="Yeni ürün ekler (Admin)", security="Bearer")
    def post(self):
        """Yeni ürün ekler (Ürün Ekle rolü)."""
        payload = request.get_json() or {}
        urun_kodu = (payload.get("urun_kodu") or "").strip()
        urun_adi = (payload.get("urun_adi") or "").strip()
        barkod = (payload.get("barkod") or "").strip()
        kritik_stok = payload.get("kritik_stok")
        fiyat_tl_raw = payload.get("fiyat_tl", payload.get("fiyatTL"))
        adet_turu = (payload.get("adet_turu") or "").strip() or None
        aciklama = (payload.get("aciklama") or "").strip() or None
        aktif = payload.get("aktif", True)

        if not urun_kodu or not urun_adi or not barkod or kritik_stok is None:
            return error_response(
                "VALIDATION_ERROR",
                "urun_kodu, urun_adi, barkod ve kritik_stok alanları zorunludur",
                400,
            )

        try:
            firma_id = get_current_firma_id()
            if not firma_id:
                return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)
            # Aynı ürün kodu veya barkod var mı kontrolü
            check_sql = """
                SELECT COUNT(*) AS Sayi FROM Urunler
                WHERE FirmaId = ? AND (UrunKodu = ? OR Barkod = ?)
            """
            count_row = db.execute_query(check_sql, (firma_id, urun_kodu, barkod))
            if count_row and count_row[0].get("Sayi", 0) > 0:
                return error_response(
                    "DUPLICATE_PRODUCT",
                    "Bu ürün kodu veya barkod zaten kullanılıyor",
                    400,
                )

            # Ürün ekle ve ID'yi al
            fiyat_tl: Decimal | None = None
            fiyat_eur: Decimal | None = None
            kur: Decimal | None = None
            kur_tarihi = None
            if fiyat_tl_raw is not None:
                try:
                    fiyat_tl = Decimal(str(fiyat_tl_raw))
                except (InvalidOperation, ValueError, TypeError):
                    return error_response("VALIDATION_ERROR", "fiyat_tl sayısal olmalıdır", 400)
                if fiyat_tl < 0:
                    return error_response("VALIDATION_ERROR", "fiyat_tl 0 veya daha büyük olmalıdır", 400)
                kur, kur_tarihi = get_eur_try_rate()
                fiyat_eur = tl_to_eur(fiyat_tl, kur)

            conn = db.get_connection()
            cursor = conn.cursor()
            insert_sql = """
                INSERT INTO Urunler (FirmaId, UrunKodu, UrunAdi, Barkod, AdetTuru, Aciklama,
                                     Aktif, KritikStok, ReelStok, ToplamGiris, ToplamCikis, OlusturmaTarihi,
                                     FiyatTL, FiyatEUR, KurEURTRY, KurTarihi)
                OUTPUT INSERTED.Id
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, DATEADD(HOUR, 3, SYSUTCDATETIME()), ?, ?, ?, ?)
            """
            cursor.execute(
                insert_sql,
                (
                    firma_id,
                    urun_kodu,
                    urun_adi,
                    barkod,
                    adet_turu,
                    aciklama,
                    1 if bool(aktif) else 0,
                    int(kritik_stok),
                    fiyat_tl if fiyat_tl is not None else None,
                    fiyat_eur if fiyat_eur is not None else None,
                    kur if kur is not None else None,
                    kur_tarihi,
                ),
            )
            new_id_row = cursor.fetchone()
            conn.commit()
            cursor.close()

            new_id = int(new_id_row[0]) if new_id_row else None
            product = _get_product_by_id(new_id) if new_id else None

            # Log kaydı
            if product:
                log_action(
                    "urun_ekleme",
                    f"Yeni ürün eklendi: {urun_kodu}",
                    urun_id=new_id,
                    yeni_deger=product,
                )

            return success_response(product, message="Ürün başarıyla eklendi", status_code=201)
        except pyodbc.IntegrityError as exc:
            # Veritabanı unique constraint ihlali (race condition koruması)
            error_msg = str(exc).lower()
            if "ux_urunler_firmaid_barkod" in error_msg or "barkod" in error_msg:
                return error_response(
                    "DUPLICATE_PRODUCT",
                    "Bu barkod zaten kullanılıyor. Aynı anda birden fazla ürün ekleme girişimi algılandı.",
                    400,
                )
            elif "ux_urunler_firmaid_urunkodu" in error_msg or "urunkodu" in error_msg:
                return error_response(
                    "DUPLICATE_PRODUCT",
                    "Bu ürün kodu zaten kullanılıyor. Aynı anda birden fazla ürün ekleme girişimi algılandı.",
                    400,
                )
            else:
                return error_response("DATABASE_CONSTRAINT_ERROR", str(exc), 400)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)


@products_ns.route("/<int:id>")
class Product(Resource):
    @jwt_required()
    @products_ns.doc(description="Ürün detayı", security="Bearer")
    def get(self, id: int):
        """Belirli bir ürünün detaylarını döndürür."""
        try:
            product = _get_product_by_id(id)
            if not product:
                return error_response("PRODUCT_NOT_FOUND", "Ürün bulunamadı", 404)
            
            # Fiyat bilgilerini kontrol et: "Stok Durum Fiyat" rolü yoksa fiyat bilgilerini çıkar
            claims = get_jwt()
            user_roles = claims.get("roller", []) if claims else []
            # Rolleri normalize et (case-insensitive, strip whitespace)
            user_roles_normalized = [str(r).strip() for r in user_roles if r]
            has_price_permission = "Stok Durum Fiyat" in user_roles_normalized
            
            if not has_price_permission:
                # Fiyat bilgilerini response'dan çıkar
                product.pop("FiyatTL", None)
                product.pop("FiyatEUR", None)
                product.pop("KurEURTRY", None)
                product.pop("KurTarihi", None)
            
            return success_response(product, status_code=200)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)

    @jwt_required()
    @require_role("Ürün Ekle")
    @products_ns.expect(product_update_model, validate=False)
    @products_ns.doc(description="Ürün günceller (Admin)", security="Bearer")
    def put(self, id: int):
        """Mevcut ürünü günceller (Ürün Ekle rolü)."""
        payload = request.get_json() or {}

        # İstemci uyumluluğu: snake_case + camelCase + farklı büyük/küçük harf kullanımları
        # normalize: sadece alfanumerik + lowercase (urun_kodu, urunKodu, UrunKodu, URUN_KODU -> urunkodu)
        def _get_payload_value(key_normalized: str):
            for k, v in payload.items():
                nk = "".join(ch for ch in str(k) if ch.isalnum()).lower()
                if nk == key_normalized:
                    return v
            return None

        urun_kodu = _get_payload_value("urunkodu")
        urun_adi = payload.get("urun_adi")
        barkod = payload.get("barkod")
        kritik_stok = payload.get("kritik_stok")
        fiyat_tl_raw = payload.get("fiyat_tl", payload.get("fiyatTL"))
        adet_turu = payload.get("adet_turu")
        aciklama = payload.get("aciklama")

        if all(v is None for v in [urun_kodu, urun_adi, barkod, kritik_stok, fiyat_tl_raw, adet_turu, aciklama]):
            return error_response(
                "VALIDATION_ERROR",
                "Güncellenecek en az bir alan gönderilmelidir",
                400,
            )

        try:
            eski = _get_product_by_id(id)
            if not eski:
                return error_response("PRODUCT_NOT_FOUND", "Ürün bulunamadı", 404)

            set_parts: List[str] = []
            params: List[Any] = []

            if urun_kodu is not None:
                v = str(urun_kodu).strip()
                if not v:
                    return error_response("VALIDATION_ERROR", "urun_kodu boş olamaz", 400)
                # Aynı firmada başka üründe aynı urun_kodu var mı?
                firma_id = get_current_firma_id()
                if not firma_id:
                    return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)
                check_sql = "SELECT COUNT(*) AS Sayi FROM Urunler WHERE FirmaId = ? AND UrunKodu = ? AND Id <> ?"
                check = db.execute_query(check_sql, (firma_id, v, id))
                if check and check[0].get("Sayi", 0) > 0:
                    return error_response("DUPLICATE_PRODUCT", "Bu ürün kodu başka bir üründe kullanılıyor", 400)
                set_parts.append("UrunKodu = ?")
                params.append(v)

            if urun_adi is not None:
                set_parts.append("UrunAdi = ?")
                params.append(urun_adi.strip())

            if barkod is not None:
                check_sql = "SELECT COUNT(*) AS Sayi FROM Urunler WHERE FirmaId = ? AND Barkod = ? AND Id <> ?"
                firma_id = get_current_firma_id()
                if not firma_id:
                    return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)
                check = db.execute_query(check_sql, (firma_id, barkod, id))
                if check and check[0].get("Sayi", 0) > 0:
                    return error_response(
                        "DUPLICATE_PRODUCT",
                        "Bu barkod başka bir üründe kullanılıyor",
                        400,
                    )
                set_parts.append("Barkod = ?")
                params.append(barkod.strip())

            if kritik_stok is not None:
                if int(kritik_stok) < 0:
                    return error_response(
                        "VALIDATION_ERROR",
                        "Kritik stok 0 veya daha büyük olmalıdır",
                        400,
                    )
                set_parts.append("KritikStok = ?")
                params.append(int(kritik_stok))

            if fiyat_tl_raw is not None:
                try:
                    fiyat_tl = Decimal(str(fiyat_tl_raw))
                except (InvalidOperation, ValueError, TypeError):
                    return error_response("VALIDATION_ERROR", "fiyat_tl sayısal olmalıdır", 400)
                if fiyat_tl < 0:
                    return error_response("VALIDATION_ERROR", "fiyat_tl 0 veya daha büyük olmalıdır", 400)
                kur, kur_tarihi = get_eur_try_rate()
                fiyat_eur = tl_to_eur(fiyat_tl, kur)
                set_parts.append("FiyatTL = ?")
                params.append(fiyat_tl)
                set_parts.append("FiyatEUR = ?")
                params.append(fiyat_eur)
                set_parts.append("KurEURTRY = ?")
                params.append(kur)
                set_parts.append("KurTarihi = ?")
                params.append(kur_tarihi)

            if adet_turu is not None:
                # serbest metin; boş string gelirse NULL'a çekelim
                v = (str(adet_turu) or "").strip()
                set_parts.append("AdetTuru = ?")
                params.append(v or None)

            if aciklama is not None:
                set_parts.append("Aciklama = ?")
                params.append(aciklama.strip())

            set_parts.append("GuncellemeTarihi = DATEADD(HOUR, 3, SYSUTCDATETIME())")
            sql = "UPDATE Urunler SET " + ", ".join(set_parts) + " WHERE Id = ? AND FirmaId = ?"
            firma_id = get_current_firma_id()
            if not firma_id:
                return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)
            params.append(id)
            params.append(firma_id)

            db.execute_query(sql, tuple(params), fetch=False)

            yeni = _get_product_by_id(id)

            if yeni:
                # Güncellenen alanları tespit et ve açıklama oluştur
                updated_fields = _detect_updated_fields(eski, yeni)
                if updated_fields:
                    if len(updated_fields) == 1:
                        aciklama = f"{updated_fields[0]} güncellendi"
                    else:
                        aciklama = f"{', '.join(updated_fields)} güncellendi"
                else:
                    aciklama = f"Ürün güncellendi: {eski['UrunKodu']}"  # Fallback
                
                log_action(
                    "urun_guncelleme",
                    aciklama,
                    urun_id=id,
                    eski_deger=eski,
                    yeni_deger=yeni,
                )

            return success_response(yeni, message="Ürün başarıyla güncellendi", status_code=200)
        except pyodbc.IntegrityError as exc:
            # Veritabanı unique constraint ihlali
            error_msg = str(exc).lower()
            if "ux_urunler_firmaid_barkod" in error_msg or "barkod" in error_msg:
                return error_response(
                    "DUPLICATE_PRODUCT",
                    "Bu barkod başka bir üründe kullanılıyor",
                    400,
                )
            elif "ux_urunler_firmaid_urunkodu" in error_msg or "urunkodu" in error_msg:
                return error_response(
                    "DUPLICATE_PRODUCT",
                    "Bu ürün kodu başka bir üründe kullanılıyor",
                    400,
                )
            else:
                return error_response("DATABASE_CONSTRAINT_ERROR", str(exc), 400)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)


@products_ns.route("/<int:id>/status")
class ProductStatus(Resource):
    @jwt_required()
    @require_role("Ürün Ekle")
    @products_ns.expect(product_status_model, validate=True)
    @products_ns.doc(description="Ürün aktif/pasif durumunu günceller (Admin)", security="Bearer")
    def put(self, id: int):
        body = request.get_json() or {}
        # istemci uyumluluğu: aktif/Aktif/isActive
        raw = body.get("aktif", body.get("Aktif", body.get("isActive")))
        aktif = _parse_bool(raw)
        if aktif is None:
            return error_response("VALIDATION_ERROR", "aktif alanı zorunludur", 400)

        try:
            firma_id = get_current_firma_id()
            if not firma_id:
                return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)
            # Ürün var mı?
            mevcut = _get_product_by_id(id)
            if not mevcut:
                return error_response("PRODUCT_NOT_FOUND", "Ürün bulunamadı", 404)

            db.execute_query(
                "UPDATE Urunler SET Aktif = ?, GuncellemeTarihi = DATEADD(HOUR, 3, SYSUTCDATETIME()) WHERE Id = ? AND FirmaId = ?",
                (1 if aktif else 0, id, firma_id),
                fetch=False,
            )
            yeni = _get_product_by_id(id)
            if yeni:
                log_action(
                    "urun_durum",
                    f"Ürün durumu güncellendi: {mevcut.get('UrunKodu')}",
                    urun_id=id,
                    eski_deger={"Aktif": mevcut.get("Aktif")},
                    yeni_deger={"Aktif": yeni.get("Aktif")},
                )
            return success_response(yeni, message="Ürün durumu güncellendi", status_code=200)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)


@products_ns.route("/lookup")
class ProductLookup(Resource):
    @jwt_required()
    @products_ns.param("barkod", "Ürün barkodu", required=True)
    @products_ns.doc(description="Barkod ile ürün ve stok bilgisini döner", security="Bearer")
    def get(self):
        barkod = (request.args.get("barkod") or "").strip()
        if not barkod:
            return error_response("VALIDATION_ERROR", "barkod query parametresi zorunludur", 400)
        try:
            firma_id = get_current_firma_id()
            if not firma_id:
                return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)
            # Önce ürünü aktif/pasif ayırmadan bul; pasifse özel mesaj dön.
            rows = db.execute_query(
                """
                SELECT TOP 1 Id, UrunKodu, UrunAdi, Barkod, AdetTuru, ReelStok, KritikStok, Aktif
                FROM Urunler
                WHERE FirmaId = ? AND Barkod = ?
                """,
                (firma_id, barkod),
            )
            if not rows:
                return error_response("PRODUCT_NOT_FOUND", "Barkod ile eşleşen ürün bulunamadı", 404)
            if not bool(rows[0].get("Aktif")):
                return error_response("PRODUCT_INACTIVE", "Pasif ürün", 404)
            r = rows[0]
            data = {
                "urun_id": r["Id"],
                "urun_kodu": r["UrunKodu"],
                "urun_adi": r["UrunAdi"],
                "barkod": r["Barkod"],
                "adet_turu": r.get("AdetTuru"),
                "stok": r["ReelStok"],
                "kritik_stok": r["KritikStok"],
            }
            return success_response(data, status_code=200)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)


@products_ns.route("/<int:id>/history")
class ProductHistory(Resource):
    @jwt_required()
    @products_ns.doc(
        description="Ürün işlem geçmişi (IslemGecmisi + StokIslemleri)",
        security="Bearer",
        params={
            "limit": {"description": "Kaç kayıt gelsin? (default 50, max limit yok)", "type": "integer", "default": 50},
        },
    )
    def get(self, id: int):
        """Belirli bir ürün için tüm işlem geçmişini döndürür (IslemGecmisi + StokIslemleri)."""
        try:
            firma_id = get_current_firma_id()
            if not firma_id:
                return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)

            # Ürün varlığını kontrol et (firma bazlı güvenlik)
            urun = _get_product_by_id(id)
            if not urun:
                return error_response("PRODUCT_NOT_FOUND", "Ürün bulunamadı", 404)

            limit = _parse_limit_no_max(request.args, default_limit=50)

            # IslemGecmisi ve StokIslemleri'ni UNION ALL ile birleştir
            # CTE kullanarak toplam limit uyguluyoruz
            query = """
                WITH BirlesikIslemler AS (
                    SELECT
                        'IslemGecmisi' as Kaynak,
                        ig.Id,
                        ig.IslemTipi,
                        ig.Aciklama,
                        ig.Tarih,
                        ig.KullaniciId,
                        k.AdSoyad as KullaniciAdSoyad,
                        NULL as Miktar,
                        ig.EskiDeger,
                        ig.YeniDeger
                    FROM IslemGecmisi ig
                    LEFT JOIN Kullanicilar k ON ig.KullaniciId = k.Id
                    WHERE ig.FirmaId = ? AND ig.UrunId = ?

                    UNION ALL

                    SELECT
                        'StokIslemleri' as Kaynak,
                        si.Id,
                        si.IslemTipi,
                        si.Aciklama,
                        si.Tarih,
                        si.KullaniciId,
                        k2.AdSoyad as KullaniciAdSoyad,
                        si.Miktar,
                        NULL as EskiDeger,
                        NULL as YeniDeger
                    FROM StokIslemleri si
                    LEFT JOIN Kullanicilar k2 ON si.KullaniciId = k2.Id
                    WHERE si.FirmaId = ? AND si.UrunId = ?
                )
                SELECT TOP (?)
                    Kaynak, Id, IslemTipi, Aciklama, Tarih,
                    KullaniciId, KullaniciAdSoyad, Miktar, EskiDeger, YeniDeger
                FROM BirlesikIslemler
                ORDER BY Tarih DESC
            """
            islemler_raw = db.execute_query(query, (firma_id, id, firma_id, id, limit))

            # Formatlama ve response hazırlama
            islemler = []
            for islem in (islemler_raw or []):
                formatted = dict(islem)
                
                # IslemTipi formatla (StokIslemleri için "giris"/"cikis" → "Giriş"/"Çıkış")
                if formatted.get("Kaynak") == "StokIslemleri" and "IslemTipi" in formatted:
                    formatted["IslemTipi"] = _format_islem_tipi_for_display(formatted.get("IslemTipi", ""))
                
                # Aciklama formatla
                if "Aciklama" in formatted:
                    formatted["Aciklama"] = _format_aciklama_for_display(formatted.get("Aciklama"))
                
                # JSON parse (EskiDeger, YeniDeger)
                if formatted.get("EskiDeger"):
                    try:
                        formatted["EskiDeger"] = json.loads(formatted["EskiDeger"]) if isinstance(formatted["EskiDeger"], str) else formatted["EskiDeger"]
                    except Exception:
                        formatted["EskiDeger"] = None
                else:
                    formatted["EskiDeger"] = None
                
                if formatted.get("YeniDeger"):
                    try:
                        formatted["YeniDeger"] = json.loads(formatted["YeniDeger"]) if isinstance(formatted["YeniDeger"], str) else formatted["YeniDeger"]
                    except Exception:
                        formatted["YeniDeger"] = None
                else:
                    formatted["YeniDeger"] = None
                
                # Kullanıcı bilgisi
                formatted["kullanici"] = {
                    "id": formatted.get("KullaniciId"),
                    "ad_soyad": formatted.get("KullaniciAdSoyad") or "Bilinmeyen Kullanıcı"
                }
                # Gereksiz alanları temizle
                formatted.pop("KullaniciId", None)
                formatted.pop("KullaniciAdSoyad", None)
                
                islemler.append(formatted)
            
            data = {
                "urun_id": urun["Id"],
                "urun_kodu": urun.get("UrunKodu"),
                "urun_adi": urun.get("UrunAdi"),
                "islemler": islemler,
                "sayfalama": {
                    "limit": limit,
                    "donen": len(islemler)
                }
            }
            
            return success_response(data, status_code=200)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)