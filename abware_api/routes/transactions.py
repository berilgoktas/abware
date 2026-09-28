"""
Stok işlemleri endpoint'leri.

- Stok girişi (entry)
- Stok çıkışı (exit)
- İşlem listesi
"""

from typing import Any, Dict, List, Optional, Tuple

from decimal import Decimal, InvalidOperation

from flask import request
from flask_restx import Namespace, Resource, fields
from flask_jwt_extended import jwt_required, get_jwt_identity

from database import db
from utils.responses import success_response, error_response
from utils.audit import log_action
from middleware.auth import get_current_firma_id, require_role
from utils.fx import get_eur_try_rate, eur_to_tl, tl_to_eur
from utils.pagination import parse_limit
from utils.raf import (
    find_raf_by_barkod,
    get_mal_kabul_rafi,
    get_cikis_rafi,
    update_raf_stok,
    create_raf_hareket,
)

transactions_ns = Namespace("transactions", description="Stok işlemleri")


# ------- Şema tanımları -------

transaction_create_model = transactions_ns.model(
    "TransactionCreate",
    {
        "barkod": fields.String(
            required=False,
            description="Ürün barkodu (barkod veya urun_id zorunlu)",
        ),
        "urun_id": fields.Integer(
            required=False,
            description="Ürün ID (barkod veya urun_id zorunlu)",
        ),
        "miktar": fields.Integer(required=True, description="İşlem miktarı (> 0)"),
        "aciklama": fields.String(required=False, description="Açıklama"),
    },
)

transaction_move_model = transactions_ns.model(
    "TransactionMove",
    {
        "barkod": fields.String(required=True, description="Ürün barkodu"),
        "yon": fields.String(required=True, description="İşlem yönü (giris|cikis)"),
        "miktar": fields.Integer(required=True, description="İşlem miktarı (> 0)"),
        "aciklama": fields.String(required=False, description="Açıklama"),
    },
)

entry_v2_model = transactions_ns.model(
    "EntryV2",
    {
        "barkod": fields.String(required=True, description="Ürün barkodu"),
        "giris_rafi_barkodu": fields.String(required=False, description="Giriş yapılacak MAL_KABUL rafı barkodu (birden fazla MAL_KABUL varsa zorunlu, tek varsa otomatik seçilir)"),
        "hedef_raf_barkodu": fields.String(required=False, description="Hedef normal raf barkodu (opsiyonel, verilirse mal kabul'dan bu rafa transfer edilir)"),
        "adet": fields.Integer(required=True, description="Giriş adedi (> 0)"),
        "aciklama": fields.String(required=False, description="İşlem açıklaması (opsiyonel)"),
    },
)

exit_v2_model = transactions_ns.model(
    "ExitV2",
    {
        "kaynak_raf_barkodu": fields.String(
            required=True,
            description="Ürünün bulunduğu raf barkodu (sadece NORMAL veya MAL_KABUL rafı). Çıkış rafı girilmez.",
        ),
        "barkod": fields.String(required=True, description="Çıkışı yapılacak ürünün barkodu"),
        "adet": fields.Integer(required=True, description="Çıkış adedi (> 0)"),
        "cikis_rafi_barkodu": fields.String(
            required=False,
            description="Genelde GİRİLMEZ. Sadece firmada birden fazla CIKIS rafı varsa hangi çıkış rafına gideceğini belirtmek için kullanılır; tek çıkış rafı varsa sistem otomatik atar.",
        ),
        "aciklama": fields.String(required=False, description="İşlem açıklaması (opsiyonel)"),
    },
)

transfer_v2_model = transactions_ns.model(
    "TransferV2",
    {
        "kaynak_raf_barkodu": fields.String(required=True, description="Alınacak raf barkodu"),
        "barkod": fields.String(required=True, description="Transfer edilecek ürün barkodu"),
        "adet": fields.Integer(required=True, description="Transfer adedi (> 0)"),
        "aciklama": fields.String(required=False, description="İşlem açıklaması (opsiyonel)"),
        "hedef_raf_barkodu": fields.String(required=True, description="Konulacak raf barkodu"),
        "hedef_urun_barkodu": fields.String(required=False, description="Konulacak ürün barkodu (doğrulama için, aynı olmalı)"),
    },
)


def _get_current_user_id() -> Optional[int]:
    """JWT içinden kullanıcı ID'sini güvenli şekilde alır."""
    try:
        raw = get_jwt_identity()
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def _find_product(barkod: Optional[str], urun_id: Optional[int]) -> Optional[Dict[str, Any]]:
    """Barkod veya ürün ID ile ürünü bulur."""
    if not barkod and urun_id is None:
        return None

    firma_id = get_current_firma_id()
    if not firma_id:
        return None

    if barkod:
        rows = db.execute_query(
            "SELECT * FROM Urunler WHERE Barkod = ? AND FirmaId = ?",
            (barkod, firma_id),
        )
    else:
        rows = db.execute_query(
            "SELECT * FROM Urunler WHERE Id = ? AND FirmaId = ?",
            (urun_id, firma_id),
        )

    return rows[0] if rows else None


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


def _format_aciklama_for_display(aciklama: Optional[str], islem_tipi: str) -> Optional[str]:
    """Aciklama içindeki "giris"/"cikis" kelimelerini "Giriş"/"Çıkış" olarak değiştirir."""
    if not aciklama:
        return aciklama
    text = str(aciklama)
    # "giris" → "Giriş", "cikis" → "Çıkış" (case-insensitive)
    text = text.replace("giris", "Giriş").replace("Giris", "Giriş").replace("GIRIS", "Giriş")
    text = text.replace("cikis", "Çıkış").replace("Cikis", "Çıkış").replace("CIKIS", "Çıkış")
    return text


def _build_transaction_response(
    stok_kayit: Dict[str, Any],
    urun: Dict[str, Any],
    miktar: int,
    onceki_stok: int,
    yeni_stok: int,
    kullanici: Dict[str, Any],
) -> Dict[str, Any]:
    """API_KAPSAM.md'deki response formatına uygun obje döner."""
    islem_tipi_raw = stok_kayit.get("IslemTipi", "")
    islem_tipi_display = _format_islem_tipi_for_display(islem_tipi_raw)
    aciklama_raw = stok_kayit.get("Aciklama")
    aciklama_display = _format_aciklama_for_display(aciklama_raw, islem_tipi_raw)
    
    return {
        "id": stok_kayit["Id"],
        "islem_tipi": islem_tipi_display,  # Görsel olarak "Giriş"/"Çıkış"
        "urun": {
            "id": urun["Id"],
            "urun_kodu": urun["UrunKodu"],
            "urun_adi": urun["UrunAdi"],
        },
        "miktar": miktar,
        "onceki_stok": onceki_stok,
        "yeni_stok": yeni_stok,
        "aciklama": aciklama_display,  # İçindeki "giris"/"cikis" → "Giriş"/"Çıkış"
        "kullanici": {
            "id": kullanici["Id"],
            "ad_soyad": kullanici["AdSoyad"],
        },
        "tarih": stok_kayit["Tarih"],
    }


def _insert_transaction_and_update_stock(
    urun: Dict[str, Any],
    islem_tipi: str,
    miktar: int,
    aciklama: Optional[str],
    kullanici_id: int,
) -> Tuple[Dict[str, Any], Dict[str, Any], int, int]:
    """
    StokIslemleri kaydı ekler ve Urunler stok kolonlarını günceller.

    Dönüş:
        (stok_kaydi, urun_yeni, onceki_stok, yeni_stok)
    """
    urun_id = urun["Id"]
    onceki_stok = int(urun["ReelStok"])

    if miktar <= 0:
        raise ValueError("Miktar 0'dan büyük olmalıdır")

    if islem_tipi == "giris":
        yeni_stok = onceki_stok + miktar
        stok_delta = miktar
        giris_delta = miktar
        cikis_delta = 0
    else:  # "cikis"
        if onceki_stok < miktar:
            raise RuntimeError(
                f"INSUFFICIENT_STOCK:Yetersiz stok. Mevcut stok: {onceki_stok}, İstenen: {miktar}"
            )
        yeni_stok = onceki_stok - miktar
        stok_delta = -miktar
        giris_delta = 0
        cikis_delta = miktar

    conn = db.get_connection()
    cursor = conn.cursor()

    # Hareket anındaki birim fiyat (TL/EUR) + kur bilgisi
    birim_fiyat_eur = None
    birim_fiyat_tl = None
    kur = None
    kur_tarihi = None
    try:
        urun_fiyat_eur_raw = urun.get("FiyatEUR")
        urun_fiyat_tl_raw = urun.get("FiyatTL")
        if urun_fiyat_eur_raw is not None or urun_fiyat_tl_raw is not None:
            kur, kur_tarihi = get_eur_try_rate()
            if urun_fiyat_eur_raw is not None:
                birim_fiyat_eur = Decimal(str(urun_fiyat_eur_raw))
                birim_fiyat_tl = eur_to_tl(birim_fiyat_eur, kur)
            else:
                birim_fiyat_tl = Decimal(str(urun_fiyat_tl_raw))
                birim_fiyat_eur = tl_to_eur(birim_fiyat_tl, kur)
    except (InvalidOperation, ValueError, TypeError):
        # fiyat alanları bozuksa hareketi yine de yap; fiyat/kuru NULL kaydet
        birim_fiyat_eur = None
        birim_fiyat_tl = None
        kur = None
        kur_tarihi = None

    # İşlem kaydı
    insert_sql = """
        INSERT INTO StokIslemleri (
            FirmaId, UrunId, IslemTipi, Miktar, Aciklama, KullaniciId, Tarih,
            BirimFiyatEUR, BirimFiyatTL, KurEURTRY, KurTarihi
        )
        OUTPUT INSERTED.Id, INSERTED.FirmaId, INSERTED.UrunId, INSERTED.IslemTipi, INSERTED.Miktar,
               INSERTED.Aciklama, INSERTED.KullaniciId, INSERTED.Tarih
        VALUES (?, ?, ?, ?, ?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()), ?, ?, ?, ?)
    """

    firma_id = get_current_firma_id()
    if not firma_id:
        raise RuntimeError("Geçersiz firma bilgisi")

    cursor.execute(
        insert_sql,
        (
            firma_id,
            urun_id,
            islem_tipi,
            miktar,
            aciklama,
            kullanici_id,
            birim_fiyat_eur,
            birim_fiyat_tl,
            kur,
            kur_tarihi,
        ),
    )
    stok_row = cursor.fetchone()

    # Ürün stok güncelleme
    update_sql = """
        UPDATE Urunler
        SET ReelStok = ReelStok + ?,
            ToplamGiris = ToplamGiris + ?,
            ToplamCikis = ToplamCikis + ?,
            GuncellemeTarihi = DATEADD(HOUR, 3, SYSUTCDATETIME())
        WHERE Id = ? AND FirmaId = ?
    """
    cursor.execute(update_sql, (stok_delta, giris_delta, cikis_delta, urun_id, firma_id))

    conn.commit()
    cursor.close()

    # Güncel ürünü tekrar oku
    urun_yeni_list = db.execute_query(
        "SELECT * FROM Urunler WHERE Id = ? AND FirmaId = ?",
        (urun_id, firma_id),
    )
    urun_yeni = urun_yeni_list[0] if urun_yeni_list else urun

    stok_dict = {
        "Id": stok_row[0],
        "FirmaId": stok_row[1],
        "UrunId": stok_row[2],
        "IslemTipi": stok_row[3],
        "Miktar": stok_row[4],
        "Aciklama": stok_row[5],
        "KullaniciId": stok_row[6],
        "Tarih": stok_row[7].isoformat() if hasattr(stok_row[7], "isoformat") else stok_row[7],
    }

    return stok_dict, urun_yeni, onceki_stok, yeni_stok


@transactions_ns.route("")
class Transactions(Resource):
    @jwt_required()
    @require_role("Stok Durumu")
    @transactions_ns.doc(
        description="Stok işlemleri listesi",
        security="Bearer",
        params={
            "limit": {"description": "Kaç kayıt gelsin? (default 100, max 5000)", "type": "integer", "default": 100},
        },
    )
    def get(self):
        """Stok işlemleri listesini döndürür (limitli)."""
        try:
            firma_id = get_current_firma_id()
            if not firma_id:
                return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)
            limit = parse_limit(request.args, default_limit=100, max_limit=5000)

            query = """
                SELECT 
                    si.*,
                    kr.Id AS KaynakRafId,
                    kr.RafKodu AS KaynakRafKodu,
                    kr.RafAdi AS KaynakRafAdi,
                    hr.Id AS HedefRafId,
                    hr.RafKodu AS HedefRafKodu,
                    hr.RafAdi AS HedefRafAdi
                FROM StokIslemleri si
                LEFT JOIN Raflar kr ON si.KaynakRafId = kr.Id
                LEFT JOIN Raflar hr ON si.HedefRafId = hr.Id
                WHERE si.FirmaId = ?
                ORDER BY si.Tarih DESC
            """
            islemler_raw = db.execute_query(query, (firma_id,))
            
            # Limit uygula (SQL Server'da TOP kullanıyoruz ama önce limit uygulayıp sonra join yapıyoruz)
            if islemler_raw and len(islemler_raw) > limit:
                islemler_raw = islemler_raw[:limit]
            
            # Görsel formatlama: islem_tipi ve aciklama alanlarını dönüştür + raf bilgilerini ekle
            islemler = []
            for islem in (islemler_raw or []):
                formatted = dict(islem)
                if "IslemTipi" in formatted:
                    formatted["IslemTipi"] = _format_islem_tipi_for_display(formatted.get("IslemTipi", ""))
                if "Aciklama" in formatted:
                    formatted["Aciklama"] = _format_aciklama_for_display(
                        formatted.get("Aciklama"), 
                        islem.get("IslemTipi", "")
                    )
                
                # Raf bilgilerini ekle
                kaynak_raf = None
                if formatted.get("KaynakRafId"):
                    kaynak_raf = {
                        "id": formatted.get("KaynakRafId"),
                        "raf_kodu": formatted.get("KaynakRafKodu"),
                        "raf_adi": formatted.get("KaynakRafAdi"),
                    }
                formatted["kaynak_raf"] = kaynak_raf
                
                hedef_raf = None
                if formatted.get("HedefRafId"):
                    hedef_raf = {
                        "id": formatted.get("HedefRafId"),
                        "raf_kodu": formatted.get("HedefRafKodu"),
                        "raf_adi": formatted.get("HedefRafAdi"),
                    }
                formatted["hedef_raf"] = hedef_raf
                
                # Gereksiz kolonları temizle
                formatted.pop("KaynakRafKodu", None)
                formatted.pop("KaynakRafAdi", None)
                formatted.pop("HedefRafKodu", None)
                formatted.pop("HedefRafAdi", None)
                
                islemler.append(formatted)
            
            data = {"islemler": islemler, "sayfalama": {"limit": limit, "donen": len(islemler)}}
            return success_response(data, status_code=200)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)


@transactions_ns.route("/entry")
class StockEntry(Resource):
    @jwt_required()
    @require_role("Stok Giriş / Çıkış")
    @transactions_ns.expect(transaction_create_model, validate=True)
    @transactions_ns.doc(description="Stok girişi yapar", security="Bearer")
    def post(self):
        """Stok girişi yapar (tüm roller)."""
        body = request.get_json() or {}
        barkod = (body.get("barkod") or "").strip() or None
        urun_id = body.get("urun_id")
        miktar = body.get("miktar")
        aciklama = (body.get("aciklama") or "").strip() or None

        if miktar is None:
            return error_response("VALIDATION_ERROR", "miktar zorunludur", 400)

        try:
            miktar_int = int(miktar)
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "miktar sayısal olmalıdır", 400)

        user_id = _get_current_user_id()
        if not user_id:
            return error_response("UNAUTHORIZED", "Geçersiz kullanıcı", 401)

        try:
            urun = _find_product(barkod, urun_id)
            if not urun:
                return error_response(
                    "PRODUCT_NOT_FOUND",
                    "Barkod veya ürün ID ile eşleşen ürün bulunamadı",
                    404,
                )

            stok_kaydi, urun_yeni, onceki, yeni = _insert_transaction_and_update_stock(
                urun, "giris", miktar_int, aciklama, user_id
            )

            # Kullanıcı bilgisi (isteğe bağlı basit bilgi)
            firma_id = get_current_firma_id()
            kullanici_rows = db.execute_query(
                "SELECT Id, AdSoyad FROM Kullanicilar WHERE Id = ? AND FirmaId = ?",
                (user_id, firma_id),
            )
            kullanici = (
                kullanici_rows[0]
                if kullanici_rows
                else {"Id": user_id, "AdSoyad": "Bilinmeyen Kullanıcı"}
            )

            response_data = _build_transaction_response(
                stok_kaydi,
                urun_yeni,
                miktar_int,
                onceki,
                yeni,
                kullanici,
            )

            # Log kaydı
            log_msg = f"Stok girişi yapıldı: {miktar_int} adet"
            if aciklama:
                log_msg = f"{log_msg} | Not: {aciklama}"
            log_action(
                "stok_giris",
                log_msg,
                urun_id=urun_yeni["Id"],
                eski_deger={"ReelStok": onceki},
                yeni_deger={"ReelStok": yeni},
            )

            return success_response(response_data, "Stok girişi başarıyla yapıldı", 201)
        except ValueError as ve:
            return error_response("VALIDATION_ERROR", str(ve), 400)
        except RuntimeError as re:
            # Özel stok hatası
            msg = str(re)
            if msg.startswith("INSUFFICIENT_STOCK:"):
                return error_response("INSUFFICIENT_STOCK", msg.split(":", 1)[1].strip(), 400)
            return error_response("INTERNAL_SERVER_ERROR", msg, 500)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)


@transactions_ns.route("/exit")
class StockExit(Resource):
    @jwt_required()
    @require_role("Stok Giriş / Çıkış")
    @transactions_ns.expect(transaction_create_model, validate=True)
    @transactions_ns.doc(description="Stok çıkışı yapar", security="Bearer")
    def post(self):
        """Stok çıkışı yapar (tüm roller)."""
        body = request.get_json() or {}
        barkod = (body.get("barkod") or "").strip() or None
        urun_id = body.get("urun_id")
        miktar = body.get("miktar")
        aciklama = (body.get("aciklama") or "").strip() or None

        if miktar is None:
            return error_response("VALIDATION_ERROR", "miktar zorunludur", 400)

        try:
            miktar_int = int(miktar)
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "miktar sayısal olmalıdır", 400)

        user_id = _get_current_user_id()
        if not user_id:
            return error_response("UNAUTHORIZED", "Geçersiz kullanıcı", 401)

        try:
            urun = _find_product(barkod, urun_id)
            if not urun:
                return error_response(
                    "PRODUCT_NOT_FOUND",
                    "Barkod veya ürün ID ile eşleşen ürün bulunamadı",
                    404,
                )

            stok_kaydi, urun_yeni, onceki, yeni = _insert_transaction_and_update_stock(
                urun, "cikis", miktar_int, aciklama, user_id
            )

            firma_id = get_current_firma_id()
            kullanici_rows = db.execute_query(
                "SELECT Id, AdSoyad FROM Kullanicilar WHERE Id = ? AND FirmaId = ?",
                (user_id, firma_id),
            )
            kullanici = (
                kullanici_rows[0]
                if kullanici_rows
                else {"Id": user_id, "AdSoyad": "Bilinmeyen Kullanıcı"}
            )

            response_data = _build_transaction_response(
                stok_kaydi,
                urun_yeni,
                miktar_int,
                onceki,
                yeni,
                kullanici,
            )

            # Log kaydı
            log_msg = f"Stok çıkışı yapıldı: {miktar_int} adet"
            if aciklama:
                log_msg = f"{log_msg} | Not: {aciklama}"
            log_action(
                "stok_cikis",
                log_msg,
                urun_id=urun_yeni["Id"],
                eski_deger={"ReelStok": onceki},
                yeni_deger={"ReelStok": yeni},
            )

            return success_response(response_data, "Stok çıkışı başarıyla yapıldı", 201)
        except ValueError as ve:
            return error_response("VALIDATION_ERROR", str(ve), 400)
        except RuntimeError as re:
            msg = str(re)
            if msg.startswith("INSUFFICIENT_STOCK:"):
                return error_response("INSUFFICIENT_STOCK", msg.split(":", 1)[1].strip(), 400)
            return error_response("INTERNAL_SERVER_ERROR", msg, 500)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)


@transactions_ns.route("/move")
class StockMove(Resource):
    @jwt_required()
    @require_role("Stok Giriş / Çıkış")
    @transactions_ns.expect(transaction_move_model, validate=True)
    @transactions_ns.doc(description="Stok hareketi yapar (giris/cikis)", security="Bearer")
    def post(self):
        """Barkod + yön + miktar ile stok hareketi yapar."""
        body = request.get_json() or {}
        barkod = (body.get("barkod") or "").strip()
        yon = (body.get("yon") or "").strip().lower()
        miktar = body.get("miktar")
        aciklama = (body.get("aciklama") or "").strip() or None

        if not barkod:
            return error_response("VALIDATION_ERROR", "barkod zorunludur", 400)
        if yon not in ("giris", "cikis"):
            return error_response("VALIDATION_ERROR", "yon alanı 'giris' veya 'cikis' olmalıdır", 400)
        if miktar is None:
            return error_response("VALIDATION_ERROR", "miktar zorunludur", 400)

        try:
            miktar_int = int(miktar)
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "miktar sayısal olmalıdır", 400)

        user_id = _get_current_user_id()
        if not user_id:
            return error_response("UNAUTHORIZED", "Geçersiz kullanıcı", 401)

        try:
            urun = _find_product(barkod, None)
            if not urun:
                return error_response("PRODUCT_NOT_FOUND", "Barkod ile eşleşen ürün bulunamadı", 404)

            stok_kaydi, urun_yeni, onceki, yeni = _insert_transaction_and_update_stock(
                urun, yon, miktar_int, aciklama, user_id
            )

            firma_id = get_current_firma_id()
            kullanici_rows = db.execute_query(
                "SELECT Id, AdSoyad FROM Kullanicilar WHERE Id = ? AND FirmaId = ?",
                (user_id, firma_id),
            )
            kullanici = (
                kullanici_rows[0]
                if kullanici_rows
                else {"Id": user_id, "AdSoyad": "Bilinmeyen Kullanıcı"}
            )

            response_data = _build_transaction_response(
                stok_kaydi,
                urun_yeni,
                miktar_int,
                onceki,
                yeni,
                kullanici,
            )

            log_msg = f"Stok hareketi yapıldı ({yon}): {miktar_int} adet"
            if aciklama:
                log_msg = f"{log_msg} | Not: {aciklama}"
            log_action(
                "stok_hareket",
                log_msg,
                urun_id=urun_yeni["Id"],
                eski_deger={"ReelStok": onceki},
                yeni_deger={"ReelStok": yeni},
            )

            return success_response(response_data, "Stok hareketi başarıyla yapıldı", 201)
        except ValueError as ve:
            return error_response("VALIDATION_ERROR", str(ve), 400)
        except RuntimeError as re:
            msg = str(re)
            if msg.startswith("INSUFFICIENT_STOCK:"):
                return error_response("INSUFFICIENT_STOCK", msg.split(":", 1)[1].strip(), 400)
            return error_response("INTERNAL_SERVER_ERROR", msg, 500)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)


@transactions_ns.route("/entry-v2")
class StockEntryV2(Resource):
    @jwt_required()
    @require_role("Stok Giriş / Çıkış")
    @transactions_ns.expect(entry_v2_model, validate=True)
    @transactions_ns.doc(description="Raf bazlı stok girişi yapar (V2)", security="Bearer")
    def post(self):
        """
        Raf bazlı stok girişi - Mal kabul akışı ile.
        
        İş Kuralları:
        1. Ürün önce MAL_KABUL rafına girilir (stok = mal kabul + normal raf toplamına dahil edilir).
        2. Hedef raf belirtilmezse: Sadece mal kabule atılır.
        3. Hedef raf belirtilirse: Mal kabul → Hedef rafa otomatik transfer. Hedef sadece NORMAL veya MAL_KABUL olabilir.
        4. Hedef raf ÇIKIŞ RAFI (CIKIS) olamaz; çıkış için exit-v2 veya transfer-v2 kullanılır.
        """
        body = request.get_json() or {}
        barkod = (body.get("barkod") or "").strip()
        giris_rafi_barkodu = (body.get("giris_rafi_barkodu") or "").strip() or None
        hedef_raf_barkodu = (body.get("hedef_raf_barkodu") or "").strip() or None
        aciklama = (body.get("aciklama") or "").strip() or None
        # Geriye uyumluluk için eski parametreyi de kontrol et
        if not giris_rafi_barkodu and body.get("raf_barkodu"):
            giris_rafi_barkodu = (body.get("raf_barkodu") or "").strip() or None
        adet = body.get("adet")
        
        if not barkod:
            return error_response("VALIDATION_ERROR", "barkod zorunludur", 400)
        if adet is None:
            return error_response("VALIDATION_ERROR", "adet zorunludur", 400)
        
        try:
            adet_int = int(adet)
            if adet_int <= 0:
                return error_response("VALIDATION_ERROR", "adet 0'dan büyük olmalıdır", 400)
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "adet sayısal olmalıdır", 400)
        
        user_id = _get_current_user_id()
        if not user_id:
            return error_response("UNAUTHORIZED", "Geçersiz kullanıcı", 401)
        
        firma_id = get_current_firma_id()
        if not firma_id:
            return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)
        
        try:
            # Ürünü bul
            urun = _find_product(barkod, None)
            if not urun:
                return error_response("PRODUCT_NOT_FOUND", "Barkod ile eşleşen ürün bulunamadı", 404)
            
            urun_id = urun["Id"]
            
            # MAL_KABUL raf sayısını kontrol et
            from utils.raf import count_raflar_by_tip
            mal_kabul_sayisi = count_raflar_by_tip("MAL_KABUL")
            
            # Birden fazla MAL_KABUL varsa giriş rafı barkodu zorunlu
            if mal_kabul_sayisi > 1 and not giris_rafi_barkodu:
                return error_response(
                    "REQUIRED_GIRIS_RAFI",
                    f"Birden fazla MAL_KABUL rafı mevcut ({mal_kabul_sayisi} adet). Giriş yapılacak raf barkodu belirtilmelidir (giris_rafi_barkodu).",
                    400,
                )
            
            # Mal kabul rafını bul
            mal_kabul_rafi = get_mal_kabul_rafi(giris_rafi_barkodu)
            if not mal_kabul_rafi:
                if giris_rafi_barkodu:
                    return error_response(
                        "RAFT_NOT_FOUND",
                        f"Belirtilen giriş rafı bulunamadı veya MAL_KABUL tipinde değil: {giris_rafi_barkodu}",
                        404,
                    )
                else:
                    return error_response("SYSTEM_ERROR", "Mal kabul rafı bulunamadı. Lütfen sistem yöneticisine başvurun.", 500)
            
            # Giriş rafının MAL_KABUL tipinde olduğunu kontrol et
            if mal_kabul_rafi.get("RafTipi") != "MAL_KABUL":
                return error_response(
                    "INVALID_RAFT_TYPE",
                    f"Belirtilen raf MAL_KABUL tipinde değil: {giris_rafi_barkodu}",
                    400,
                )
            
            mal_kabul_raf_id = mal_kabul_rafi["Id"]
            
            # Hedef raf varsa, çıkış rafına hareket yasağını önceden kontrol et
            hedef_raf_id = None
            if hedef_raf_barkodu:
                hedef_raf = find_raf_by_barkod(hedef_raf_barkodu)
                if not hedef_raf:
                    return error_response("RAFT_NOT_FOUND", f"Hedef raf bulunamadı: {hedef_raf_barkodu}", 404)
                if hedef_raf.get("RafTipi") == "CIKIS":
                    return error_response(
                        "INVALID_RAFT_TYPE",
                        "Giriş işleminde çıkış rafına (CIKIS) hareket yapılamaz. Hedef raf normal raf olmalıdır.",
                        400,
                    )
                hedef_raf_id = hedef_raf["Id"]
            
            conn = db.get_connection()
            cursor = conn.cursor()
            
            try:
                # 1. Önce mal kabul rafına ekle
                onceki_mal_kabul, yeni_mal_kabul = update_raf_stok(mal_kabul_raf_id, urun_id, adet_int)
                
                # 2. StokIslemleri kaydı oluştur (giriş işlemi)
                aciklama_metni = aciklama or "Raf bazlı giriş (V2)"
                stok_islemi_sql = """
                    INSERT INTO StokIslemleri (
                        FirmaId, UrunId, IslemTipi, Miktar, Aciklama, KullaniciId, Tarih,
                        KaynakRafId, HedefRafId
                    )
                    OUTPUT INSERTED.Id
                    VALUES (?, ?, 'giris', ?, ?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()), NULL, ?)
                """
                cursor.execute(
                    stok_islemi_sql,
                    (firma_id, urun_id, adet_int, aciklama_metni, user_id, mal_kabul_raf_id),
                )
                stok_islemi_id = cursor.fetchone()[0]
                
                # 3. RafHareketleri kaydı (mal kabul'a giriş)
                create_raf_hareket(
                    stok_islemi_id=stok_islemi_id,
                    kaynak_raf_id=None,
                    hedef_raf_id=mal_kabul_raf_id,
                    urun_id=urun_id,
                    miktar=adet_int,
                    islem_tipi="GIRIS",
                    kullanici_id=user_id,
                    aciklama="Mal kabul rafına giriş",
                )
                
                # 4. Eğer hedef raf barkodu verildiyse, mal kabul'dan çıkar ve hedef rafa ekle
                if hedef_raf_barkodu and hedef_raf_id:
                    hedef_raf = find_raf_by_barkod(hedef_raf_barkodu)
                    # Mal kabul'dan çıkar
                    update_raf_stok(mal_kabul_raf_id, urun_id, -adet_int)
                    
                    # Hedef rafa ekle
                    onceki_hedef, yeni_hedef = update_raf_stok(hedef_raf_id, urun_id, adet_int)
                    
                    # StokIslemleri'ni güncelle (HedefRafId)
                    cursor.execute(
                        "UPDATE StokIslemleri SET HedefRafId = ? WHERE Id = ?",
                        (hedef_raf_id, stok_islemi_id),
                    )
                    
                    # RafHareketleri kaydı (mal kabul'dan hedef rafa transfer)
                    create_raf_hareket(
                        stok_islemi_id=stok_islemi_id,
                        kaynak_raf_id=mal_kabul_raf_id,
                        hedef_raf_id=hedef_raf_id,
                        urun_id=urun_id,
                        miktar=adet_int,
                        islem_tipi="TRANSFER",
                        kullanici_id=user_id,
                        aciklama=f"Mal kabul'dan {hedef_raf['RafKodu']} rafına transfer",
                    )
                
                # 5. Urunler.ReelStok güncelle (mevcut mantık)
                cursor.execute(
                    """
                    UPDATE Urunler
                    SET ReelStok = ReelStok + ?,
                        ToplamGiris = ToplamGiris + ?,
                        GuncellemeTarihi = DATEADD(HOUR, 3, SYSUTCDATETIME())
                    WHERE Id = ? AND FirmaId = ?
                    """,
                    (adet_int, adet_int, urun_id, firma_id),
                )
                
                conn.commit()
                
                # Kullanıcı bilgisi
                kullanici_rows = db.execute_query(
                    "SELECT Id, AdSoyad FROM Kullanicilar WHERE Id = ? AND FirmaId = ?",
                    (user_id, firma_id),
                )
                kullanici = (
                    kullanici_rows[0]
                    if kullanici_rows
                    else {"Id": user_id, "AdSoyad": "Bilinmeyen Kullanıcı"}
                )
                
                # Response
                response_data = {
                    "id": stok_islemi_id,
                    "islem_tipi": "Giriş",
                    "urun": {
                        "id": urun["Id"],
                        "urun_kodu": urun["UrunKodu"],
                        "urun_adi": urun["UrunAdi"],
                    },
                    "miktar": adet_int,
                    "kullanici": {
                        "id": kullanici["Id"],
                        "ad_soyad": kullanici["AdSoyad"],
                    },
                    "mal_kabul_rafi": {
                        "id": mal_kabul_rafi["Id"],
                        "raf_kodu": mal_kabul_rafi["RafKodu"],
                        "raf_adi": mal_kabul_rafi["RafAdi"],
                    },
                }
                
                if hedef_raf_id:
                    hedef_raf_info = find_raf_by_barkod(hedef_raf_barkodu)
                    response_data["hedef_raf"] = {
                        "id": hedef_raf_info["Id"],
                        "raf_kodu": hedef_raf_info["RafKodu"],
                        "raf_adi": hedef_raf_info["RafAdi"],
                    }
                
                # Log
                log_msg = f"Raf bazlı stok girişi (V2): {adet_int} adet → {mal_kabul_rafi['RafKodu']} (MAL_KABUL)"
                if hedef_raf_barkodu:
                    log_msg += f" → {hedef_raf_barkodu} rafına transfer"
                log_action(
                    "stok_giris_v2",
                    log_msg,
                    urun_id=urun_id,
                    yeni_deger={"ReelStok": urun["ReelStok"] + adet_int},
                )
                
                return success_response(response_data, "Raf bazlı stok girişi başarıyla yapıldı", 201)
            
            except Exception as e:
                conn.rollback()
                raise
            finally:
                cursor.close()
        
        except RuntimeError as re:
            msg = str(re)
            if "Yetersiz" in msg or "bulunamadı" in msg.lower():
                return error_response("VALIDATION_ERROR", msg, 400)
            return error_response("INTERNAL_SERVER_ERROR", msg, 500)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)


@transactions_ns.route("/exit-v2")
class StockExitV2(Resource):
    @jwt_required()
    @require_role("Stok Giriş / Çıkış")
    @transactions_ns.expect(exit_v2_model, validate=True)
    @transactions_ns.doc(
        description="Raf bazlı stok çıkışı yapar (V2). Senaryo: Kullanıcı A-01 normal rafındaki 5 adet X ürününü çıkışa ayırmak ister → kaynak_raf_barkodu=A-01 barkodu, barkod=X barkodu, adet=5 gönderir; çıkış rafı girilmez, sistem ürünü otomatik çıkış rafına atar.",
        security="Bearer",
    )
    def post(self):
        """
        Raf bazlı stok çıkışı (V2). Kullanıcı sadece ürünün bulunduğu rafı ve ürünü girer; çıkış rafı bilgisi girilmez (tek CIKIS varsa otomatik seçilir).
        
        Giren bilgiler:
        - kaynak_raf_barkodu: Ürünün şu an bulunduğu raf (NORMAL veya MAL_KABUL). Çıkış rafı değil.
        - barkod: Ürün barkodu.
        - adet: Çıkış adedi.
        - cikis_rafi_barkodu: Opsiyonel; sadece birden fazla çıkış rafı varsa belirtilir.
        
        Sonuç: Ürün kaynak raftan düşülür, otomatik olarak (tek) çıkış rafına eklenir; ReelStok azalır.
        Çıkış rafından eksilme sadece transfer-v2 ile yapılır.
        """
        body = request.get_json() or {}
        kaynak_raf_barkodu = (body.get("kaynak_raf_barkodu") or "").strip()
        cikis_rafi_barkodu = (body.get("cikis_rafi_barkodu") or "").strip() or None
        aciklama = (body.get("aciklama") or "").strip() or None
        # Geriye uyumluluk için eski parametreyi de kontrol et
        if not kaynak_raf_barkodu and body.get("raf_barkodu"):
            kaynak_raf_barkodu = (body.get("raf_barkodu") or "").strip()
        barkod = (body.get("barkod") or "").strip()
        adet = body.get("adet")
        
        if not kaynak_raf_barkodu:
            return error_response("VALIDATION_ERROR", "kaynak_raf_barkodu zorunludur", 400)
        if not barkod:
            return error_response("VALIDATION_ERROR", "barkod zorunludur", 400)
        if adet is None:
            return error_response("VALIDATION_ERROR", "adet zorunludur", 400)
        
        try:
            adet_int = int(adet)
            if adet_int <= 0:
                return error_response("VALIDATION_ERROR", "adet 0'dan büyük olmalıdır", 400)
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "adet sayısal olmalıdır", 400)
        
        user_id = _get_current_user_id()
        if not user_id:
            return error_response("UNAUTHORIZED", "Geçersiz kullanıcı", 401)
        
        firma_id = get_current_firma_id()
        if not firma_id:
            return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)
        
        try:
            # Rafı bul (kaynak raf)
            kaynak_raf = find_raf_by_barkod(kaynak_raf_barkodu)
            if not kaynak_raf:
                return error_response("RAFT_NOT_FOUND", f"Kaynak raf bulunamadı: {kaynak_raf_barkodu}", 404)
            kaynak_raf_id = kaynak_raf["Id"]
            
            # Ürünü bul
            urun = _find_product(barkod, None)
            if not urun:
                return error_response("PRODUCT_NOT_FOUND", "Barkod ile eşleşen ürün bulunamadı", 404)
            urun_id = urun["Id"]
            
            from utils.raf import get_raf_stok
            mevcut_stok = get_raf_stok(kaynak_raf_id, urun_id)
            if mevcut_stok < adet_int:
                return error_response(
                    "INSUFFICIENT_STOCK",
                    f"Yetersiz raf stoku. Mevcut stok: {mevcut_stok}, İstenen: {adet_int}",
                    400,
                )
            
            # Çıkış işlemi sadece çıkış rafı HARİÇ (NORMAL veya MAL_KABUL) kabul edilir.
            # Çıkış rafından eksilme sadece transfer-v2 ile yapılır; yıl sonuna kadar çıkış rafındaki miktar takip edilir.
            if kaynak_raf.get("RafTipi") == "CIKIS":
                return error_response(
                    "INVALID_SOURCE_RAFT",
                    "Çıkış işlemi çıkış rafından yapılamaz. Sadece normal raf veya mal kabul rafından çıkış yapılabilir; ürün çıkış rafına gönderilir. Çıkış rafından eksiltme için transfer kullanın.",
                    400,
                )
            
            # Kaynak = NORMAL veya MAL_KABUL → çıkış rafına at; ReelStok azalır.
            # Çıkış rafı kullanıcıdan zorunlu değil: sadece kaynak raf (normal/mal kabul) + ürün + adet girer.
            from utils.raf import count_raflar_by_tip
            cikis_raf_sayisi = count_raflar_by_tip("CIKIS")
            # cikis_rafi_barkodu sadece gerçekten bir CIKIS rafına aitse kullan; değilse yok say (varsayılan çıkış rafı)
            cikis_rafi_net = None
            if cikis_rafi_barkodu:
                gecici_raf = find_raf_by_barkod(cikis_rafi_barkodu)
                if gecici_raf and gecici_raf.get("RafTipi") == "CIKIS":
                    cikis_rafi_net = gecici_raf
            if not cikis_rafi_net:
                if cikis_raf_sayisi > 1:
                    return error_response(
                        "REQUIRED_CIKIS_RAFI",
                        f"Birden fazla CIKIS rafı mevcut ({cikis_raf_sayisi} adet). Çıkış yapılacak raf barkodu belirtilmelidir (cikis_rafi_barkodu).",
                        400,
                    )
                cikis_rafi_net = get_cikis_rafi(None)
            cikis_rafi = cikis_rafi_net
            if not cikis_rafi:
                return error_response("SYSTEM_ERROR", "Çıkış rafı bulunamadı. Lütfen sistem yöneticisine başvurun.", 500)
            cikis_raf_id = cikis_rafi["Id"]
            
            conn = db.get_connection()
            cursor = conn.cursor()
            try:
                onceki_kaynak, yeni_kaynak = update_raf_stok(kaynak_raf_id, urun_id, -adet_int)
                onceki_cikis, yeni_cikis = update_raf_stok(cikis_raf_id, urun_id, adet_int)
                aciklama_metni = aciklama or "Raf bazlı çıkış (V2)"
                stok_islemi_sql = """
                    INSERT INTO StokIslemleri (
                        FirmaId, UrunId, IslemTipi, Miktar, Aciklama, KullaniciId, Tarih,
                        KaynakRafId, HedefRafId
                    )
                    OUTPUT INSERTED.Id
                    VALUES (?, ?, 'cikis', ?, ?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()), ?, ?)
                """
                cursor.execute(
                    stok_islemi_sql,
                    (firma_id, urun_id, adet_int, aciklama_metni, user_id, kaynak_raf_id, cikis_raf_id),
                )
                stok_islemi_id = cursor.fetchone()[0]
                create_raf_hareket(
                    stok_islemi_id=stok_islemi_id,
                    kaynak_raf_id=kaynak_raf_id,
                    hedef_raf_id=cikis_raf_id,
                    urun_id=urun_id,
                    miktar=adet_int,
                    islem_tipi="CIKIS",
                    kullanici_id=user_id,
                    aciklama=f"{kaynak_raf['RafKodu']} rafından çıkış rafına transfer",
                )
                cursor.execute(
                    """
                    UPDATE Urunler
                    SET ReelStok = ReelStok - ?,
                        ToplamCikis = ToplamCikis + ?,
                        GuncellemeTarihi = DATEADD(HOUR, 3, SYSUTCDATETIME())
                    WHERE Id = ? AND FirmaId = ?
                    """,
                    (adet_int, adet_int, urun_id, firma_id),
                )
                conn.commit()
                kullanici_rows = db.execute_query(
                    "SELECT Id, AdSoyad FROM Kullanicilar WHERE Id = ? AND FirmaId = ?",
                    (user_id, firma_id),
                )
                kullanici = (
                    kullanici_rows[0]
                    if kullanici_rows
                    else {"Id": user_id, "AdSoyad": "Bilinmeyen Kullanıcı"}
                )
                response_data = {
                    "id": stok_islemi_id,
                    "islem_tipi": "Çıkış",
                    "urun": {"id": urun["Id"], "urun_kodu": urun["UrunKodu"], "urun_adi": urun["UrunAdi"]},
                    "miktar": adet_int,
                    "kullanici": {"id": kullanici["Id"], "ad_soyad": kullanici["AdSoyad"]},
                    "kaynak_raf": {"id": kaynak_raf["Id"], "raf_kodu": kaynak_raf["RafKodu"], "raf_adi": kaynak_raf["RafAdi"]},
                    "cikis_rafi": {"id": cikis_rafi["Id"], "raf_kodu": cikis_rafi["RafKodu"], "raf_adi": cikis_rafi["RafAdi"]},
                }
                log_action(
                    "stok_cikis_v2",
                    f"Raf bazlı stok çıkışı (V2): {adet_int} adet - {kaynak_raf['RafKodu']} → {cikis_rafi['RafKodu']}",
                    urun_id=urun_id,
                    yeni_deger={"ReelStok": urun["ReelStok"] - adet_int},
                )
                return success_response(response_data, "Raf bazlı stok çıkışı başarıyla yapıldı. Ürün çıkış rafında bekliyor.", 201)
            except Exception as e:
                conn.rollback()
                raise
            finally:
                cursor.close()
        
        except RuntimeError as re:
            msg = str(re)
            if "Yetersiz" in msg or "bulunamadı" in msg.lower():
                return error_response("VALIDATION_ERROR", msg, 400)
            return error_response("INTERNAL_SERVER_ERROR", msg, 500)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)


@transactions_ns.route("/transfer-v2")
class StockTransferV2(Resource):
    @jwt_required()
    @require_role("Stok Giriş / Çıkış")
    @transactions_ns.expect(transfer_v2_model, validate=True)
    @transactions_ns.doc(description="Raf transfer işlemi yapar (V2)", security="Bearer")
    def post(self):
        """Raf transfer işlemi - Ürünü bir raftan diğerine taşır."""
        body = request.get_json() or {}
        kaynak_raf_barkodu = (body.get("kaynak_raf_barkodu") or "").strip()
        barkod = (body.get("barkod") or "").strip()
        adet = body.get("adet")
        hedef_raf_barkodu = (body.get("hedef_raf_barkodu") or "").strip()
        hedef_urun_barkodu = (body.get("hedef_urun_barkodu") or "").strip() or None
        aciklama = (body.get("aciklama") or "").strip() or None
        
        if not kaynak_raf_barkodu:
            return error_response("VALIDATION_ERROR", "kaynak_raf_barkodu zorunludur", 400)
        if not barkod:
            return error_response("VALIDATION_ERROR", "barkod zorunludur", 400)
        if not hedef_raf_barkodu:
            return error_response("VALIDATION_ERROR", "hedef_raf_barkodu zorunludur", 400)
        if adet is None:
            return error_response("VALIDATION_ERROR", "adet zorunludur", 400)
        
        try:
            adet_int = int(adet)
            if adet_int <= 0:
                return error_response("VALIDATION_ERROR", "adet 0'dan büyük olmalıdır", 400)
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "adet sayısal olmalıdır", 400)
        
        if kaynak_raf_barkodu == hedef_raf_barkodu:
            return error_response("VALIDATION_ERROR", "Kaynak raf ve hedef raf aynı olamaz", 400)
        
        user_id = _get_current_user_id()
        if not user_id:
            return error_response("UNAUTHORIZED", "Geçersiz kullanıcı", 401)
        
        firma_id = get_current_firma_id()
        if not firma_id:
            return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)
        
        try:
            # Kaynak rafı bul
            kaynak_raf = find_raf_by_barkod(kaynak_raf_barkodu)
            if not kaynak_raf:
                return error_response("RAFT_NOT_FOUND", f"Kaynak raf bulunamadı: {kaynak_raf_barkodu}", 404)
            
            kaynak_raf_id = kaynak_raf["Id"]
            
            # Hedef rafı bul
            hedef_raf = find_raf_by_barkod(hedef_raf_barkodu)
            if not hedef_raf:
                return error_response("RAFT_NOT_FOUND", f"Hedef raf bulunamadı: {hedef_raf_barkodu}", 404)
            hedef_raf_id = hedef_raf["Id"]
            
            # Ürünü bul
            urun = _find_product(barkod, None)
            if not urun:
                return error_response("PRODUCT_NOT_FOUND", "Barkod ile eşleşen ürün bulunamadı", 404)
            
            urun_id = urun["Id"]
            
            # Hedef ürün barkodu verildiyse doğrulama yap (aynı ürün olmalı)
            if hedef_urun_barkodu:
                hedef_urun = _find_product(hedef_urun_barkodu, None)
                if not hedef_urun:
                    return error_response("PRODUCT_NOT_FOUND", "Hedef ürün barkodu ile eşleşen ürün bulunamadı", 404)
                if hedef_urun["Id"] != urun_id:
                    return error_response("VALIDATION_ERROR", "Kaynak ve hedef ürün barkodları aynı ürünü göstermelidir", 400)
            
            # RafStok'ta yeterli stok var mı kontrol et (kaynak rafta)
            from utils.raf import get_raf_stok
            mevcut_stok = get_raf_stok(kaynak_raf_id, urun_id)
            if mevcut_stok < adet_int:
                return error_response(
                    "INSUFFICIENT_STOCK",
                    f"Yetersiz raf stoku. Mevcut stok: {mevcut_stok}, İstenen: {adet_int}",
                    400,
                )
            
            conn = db.get_connection()
            cursor = conn.cursor()
            
            try:
                # 1. Kaynak raftan çıkar
                onceki_kaynak, yeni_kaynak = update_raf_stok(kaynak_raf_id, urun_id, -adet_int)
                
                # 2. Hedef rafa ekle
                onceki_hedef, yeni_hedef = update_raf_stok(hedef_raf_id, urun_id, adet_int)
                
                # 3. StokIslemleri kaydı oluştur (transfer işlemi)
                aciklama_metni = aciklama or f"{kaynak_raf['RafKodu']} rafından {hedef_raf['RafKodu']} rafına transfer"
                stok_islemi_sql = """
                    INSERT INTO StokIslemleri (
                        FirmaId, UrunId, IslemTipi, Miktar, Aciklama, KullaniciId, Tarih,
                        KaynakRafId, HedefRafId
                    )
                    OUTPUT INSERTED.Id
                    VALUES (?, ?, 'transfer', ?, ?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()), ?, ?)
                """
                cursor.execute(
                    stok_islemi_sql,
                    (firma_id, urun_id, adet_int, aciklama_metni, user_id, kaynak_raf_id, hedef_raf_id),
                )
                stok_islemi_id = cursor.fetchone()[0]
                
                # 4. RafHareketleri kaydı (transfer)
                hareket = create_raf_hareket(
                    stok_islemi_id=stok_islemi_id,
                    kaynak_raf_id=kaynak_raf_id,
                    hedef_raf_id=hedef_raf_id,
                    urun_id=urun_id,
                    miktar=adet_int,
                    islem_tipi="TRANSFER",
                    kullanici_id=user_id,
                    aciklama=aciklama_metni,
                )
                
                # 5. ReelStok güncellemesi
                # Hedef raf CIKIS ise: ürün depodan çıkıyor → ReelStok düşer
                if hedef_raf.get("RafTipi") == "CIKIS":
                    cursor.execute(
                        """
                        UPDATE Urunler
                        SET ReelStok = ReelStok - ?,
                            ToplamCikis = ToplamCikis + ?,
                            GuncellemeTarihi = DATEADD(HOUR, 3, SYSUTCDATETIME())
                        WHERE Id = ? AND FirmaId = ?
                        """,
                        (adet_int, adet_int, urun_id, firma_id),
                    )
                # Kaynak raf CIKIS, hedef NORMAL/MAL_KABUL ise: ürün depoya geri geliyor → ReelStok artar
                elif kaynak_raf.get("RafTipi") == "CIKIS" and hedef_raf.get("RafTipi") in ("NORMAL", "MAL_KABUL"):
                    cursor.execute(
                        """
                        UPDATE Urunler
                        SET ReelStok = ReelStok + ?,
                            GuncellemeTarihi = DATEADD(HOUR, 3, SYSUTCDATETIME())
                        WHERE Id = ? AND FirmaId = ?
                        """,
                        (adet_int, urun_id, firma_id),
                    )
                
                conn.commit()
                
                # Kullanıcı bilgisi
                kullanici_rows = db.execute_query(
                    "SELECT Id, AdSoyad FROM Kullanicilar WHERE Id = ? AND FirmaId = ?",
                    (user_id, firma_id),
                )
                kullanici = (
                    kullanici_rows[0]
                    if kullanici_rows
                    else {"Id": user_id, "AdSoyad": "Bilinmeyen Kullanıcı"}
                )
                
                # Response
                response_data = {
                    "id": hareket["Id"],
                    "islem_tipi": "Transfer",
                    "urun": {
                        "id": urun["Id"],
                        "urun_kodu": urun["UrunKodu"],
                        "urun_adi": urun["UrunAdi"],
                    },
                    "miktar": adet_int,
                    "kullanici": {
                        "id": kullanici["Id"],
                        "ad_soyad": kullanici["AdSoyad"],
                    },
                    "kaynak_raf": {
                        "id": kaynak_raf["Id"],
                        "raf_kodu": kaynak_raf["RafKodu"],
                        "raf_adi": kaynak_raf["RafAdi"],
                    },
                    "hedef_raf": {
                        "id": hedef_raf["Id"],
                        "raf_kodu": hedef_raf["RafKodu"],
                        "raf_adi": hedef_raf["RafAdi"],
                    },
                    "onceki_stok": {
                        "kaynak_raf": onceki_kaynak,
                        "hedef_raf": onceki_hedef,
                    },
                    "yeni_stok": {
                        "kaynak_raf": yeni_kaynak,
                        "hedef_raf": yeni_hedef,
                    },
                }
                
                # Log
                log_msg = f"Raf transfer (V2): {adet_int} adet - {kaynak_raf['RafKodu']} → {hedef_raf['RafKodu']}"
                log_action(
                    "raf_transfer_v2",
                    log_msg,
                    urun_id=urun_id,
                    yeni_deger={
                        "kaynak_raf_stok": yeni_kaynak,
                        "hedef_raf_stok": yeni_hedef,
                    },
                )
                
                return success_response(response_data, "Raf transfer işlemi başarıyla yapıldı", 201)
            
            except Exception as e:
                conn.rollback()
                raise
            finally:
                cursor.close()
        
        except RuntimeError as re:
            msg = str(re)
            if "Yetersiz" in msg or "bulunamadı" in msg.lower():
                return error_response("VALIDATION_ERROR", msg, 400)
            return error_response("INTERNAL_SERVER_ERROR", msg, 500)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)

