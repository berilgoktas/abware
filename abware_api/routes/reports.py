"""
Raporlar endpoint'leri
"""
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta
from decimal import Decimal

from flask import request
from flask_restx import Namespace, Resource, fields
from flask_jwt_extended import jwt_required

from database import db
from utils.responses import success_response, error_response
from middleware.auth import require_role, get_current_firma_id
from utils.excel_reports import (
    create_excel_workbook,
    add_worksheet_with_headers,
    add_data_row,
    auto_adjust_column_widths,
    save_workbook_to_response,
    format_date_for_excel,
    format_decimal_for_excel,
)

reports_ns = Namespace("reports", description="Raporlar")


def _parse_date(date_str: Optional[str]) -> Optional[datetime]:
    """Tarih string'ini datetime'a çevirir. Parantez içinde gelse bile kabul eder (YYYY-MM-DD)."""
    if not date_str:
        return None
    s = date_str.strip().strip("()").strip()
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def _parse_optional_int(value: Any) -> Optional[int]:
    """Query parametresinden opsiyonel integer döndürür. Boş/None ise None."""
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _safe_int(value: Any, default: int = 0) -> int:
    """None veya geçersiz değeri default'a çevirir; DB NULL için int() hatasını önler."""
    if value is None:
        return default
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


def _get_default_date_range() -> tuple[datetime, datetime]:
    """Varsayılan tarih aralığını döndürür (son 1 yıl)."""
    end_date = datetime.now()
    start_date = end_date - timedelta(days=365)
    return start_date, end_date


@reports_ns.route("/stock")
class StockReport(Resource):
    @jwt_required()
    @require_role("Kontrol Paneli")
    @reports_ns.doc(
        description="Stok raporu Excel formatında",
        security="Bearer",
        params={
            "baslangic_tarihi": {
                "description": "Rapor başlangıç tarihi, format YYYY-MM-DD. Boş bırakılırsa son 1 yıl kullanılır.",
                "type": "string",
                "required": False,
            },
            "bitis_tarihi": {
                "description": "Rapor bitiş tarihi, format YYYY-MM-DD. Boş bırakılırsa son 1 yıl kullanılır.",
                "type": "string",
                "required": False,
            },
            "urun_id": {
                "description": "Ürün ID filtresi. Gönderilmezse tüm ürünler dahil edilir.",
                "type": "integer",
                "required": False,
            },
        },
    )
    def get(self):
        """Stok raporu oluşturur ve Excel dosyası olarak döndürür. Tarih ve urun_id opsiyoneldir."""
        try:
            firma_id = get_current_firma_id()
            if not firma_id:
                return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)

            # Tarih aralığını al
            baslangic_tarihi = _parse_date(request.args.get("baslangic_tarihi"))
            bitis_tarihi = _parse_date(request.args.get("bitis_tarihi"))
            
            if not baslangic_tarihi or not bitis_tarihi:
                baslangic_tarihi, bitis_tarihi = _get_default_date_range()
            
            # Tarih aralığı kontrolü
            if baslangic_tarihi > bitis_tarihi:
                return error_response(
                    "VALIDATION_ERROR",
                    "Başlangıç tarihi bitiş tarihinden sonra olamaz",
                    400,
                )
            
            urun_id = _parse_optional_int(request.args.get("urun_id"))
            
            # Excel workbook oluştur
            workbook = create_excel_workbook()
            
            # SAYFA 1: Ürün Stok Özeti
            headers_stok = [
                "Ürün Kodu",
                "Ürün Adı",
                "Barkod",
                "Mevcut Stok (Adet)",
                "Birim Fiyat (EUR)",
                "Birim Fiyat (TL)",
                "Toplam Değer (EUR)",
                "Toplam Değer (TL)",
            ]
            ws_stok = add_worksheet_with_headers(workbook, "Stok Özeti", headers_stok)
            
            query_stok = """
                SELECT 
                    Id, UrunKodu, UrunAdi, Barkod, ReelStok,
                    COALESCE(FiyatEUR, 0) AS BirimFiyatEUR,
                    COALESCE(FiyatTL, 0) AS BirimFiyatTL
                FROM Urunler
                WHERE FirmaId = ? AND Aktif = 1
            """
            params_stok = [firma_id]
            
            if urun_id:
                query_stok += " AND Id = ?"
                params_stok.append(urun_id)
            
            query_stok += " ORDER BY UrunAdi ASC"
            
            stok_data = db.execute_query(query_stok, tuple(params_stok))
            
            row_num = 2
            for urun in (stok_data or []):
                mevcut_stok = _safe_int(urun.get("ReelStok"))
                birim_fiyat_eur = format_decimal_for_excel(urun.get("BirimFiyatEUR", 0))
                birim_fiyat_tl = format_decimal_for_excel(urun.get("BirimFiyatTL", 0))
                toplam_deger_eur = birim_fiyat_eur * mevcut_stok if birim_fiyat_eur else 0
                toplam_deger_tl = birim_fiyat_tl * mevcut_stok if birim_fiyat_tl else 0
                
                add_data_row(
                    ws_stok,
                    [
                        urun.get("UrunKodu", ""),
                        urun.get("UrunAdi", ""),
                        urun.get("Barkod", ""),
                        mevcut_stok,
                        birim_fiyat_eur,
                        birim_fiyat_tl,
                        toplam_deger_eur,
                        toplam_deger_tl,
                    ],
                    row_num,
                )
                row_num += 1
            
            auto_adjust_column_widths(ws_stok)
            
            # SAYFA 2: Giriş/Çıkış Detayları
            headers_detay = [
                "Tarih",
                "Ürün Kodu",
                "Ürün Adı",
                "İşlem Tipi",
                "Miktar",
                "Birim Fiyat EUR",
                "Birim Fiyat TL",
                "Toplam Değer EUR",
                "Toplam Değer TL",
                "Kullanıcı",
                "Açıklama",
            ]
            ws_detay = add_worksheet_with_headers(workbook, "Giriş Çıkış Detayları", headers_detay)
            
            query_detay = """
                SELECT 
                    si.Tarih,
                    u.UrunKodu,
                    u.UrunAdi,
                    CASE 
                        WHEN si.IslemTipi = 'giris' THEN 'Giriş'
                        WHEN si.IslemTipi = 'cikis' THEN 'Çıkış'
                        WHEN si.IslemTipi = 'transfer' THEN 'Transfer'
                        ELSE si.IslemTipi
                    END AS IslemTipi,
                    si.Miktar,
                    COALESCE(si.BirimFiyatEUR, 0) AS BirimFiyatEUR,
                    COALESCE(si.BirimFiyatTL, 0) AS BirimFiyatTL,
                    k.AdSoyad AS KullaniciAdi,
                    si.Aciklama
                FROM StokIslemleri si
                INNER JOIN Urunler u ON si.UrunId = u.Id
                LEFT JOIN Kullanicilar k ON si.KullaniciId = k.Id
                WHERE si.FirmaId = ?
                    AND CONVERT(date, si.Tarih) >= CONVERT(date, ?)
                    AND CONVERT(date, si.Tarih) <= CONVERT(date, ?)
            """
            params_detay = [firma_id, baslangic_tarihi, bitis_tarihi]
            
            if urun_id:
                query_detay += " AND si.UrunId = ?"
                params_detay.append(urun_id)
            
            query_detay += " ORDER BY si.Tarih DESC, u.UrunAdi ASC"
            
            detay_data = db.execute_query(query_detay, tuple(params_detay))
            
            row_num = 2
            for detay in (detay_data or []):
                miktar = _safe_int(detay.get("Miktar"))
                birim_fiyat_eur = format_decimal_for_excel(detay.get("BirimFiyatEUR", 0))
                birim_fiyat_tl = format_decimal_for_excel(detay.get("BirimFiyatTL", 0))
                toplam_eur = birim_fiyat_eur * miktar if birim_fiyat_eur else 0
                toplam_tl = birim_fiyat_tl * miktar if birim_fiyat_tl else 0
                
                tarih_value = detay.get("Tarih")
                if isinstance(tarih_value, datetime):
                    tarih_str = tarih_value.strftime("%Y-%m-%d %H:%M:%S")
                else:
                    tarih_str = format_date_for_excel(tarih_value)
                
                add_data_row(
                    ws_detay,
                    [
                        tarih_str,
                        detay.get("UrunKodu", ""),
                        detay.get("UrunAdi", ""),
                        detay.get("IslemTipi", ""),
                        miktar,
                        birim_fiyat_eur,
                        birim_fiyat_tl,
                        toplam_eur,
                        toplam_tl,
                        detay.get("KullaniciAdi", ""),
                        detay.get("Aciklama", ""),
                    ],
                    row_num,
                )
                row_num += 1
            
            auto_adjust_column_widths(ws_detay)
            
            # SAYFA 3: Yıllık Özet
            headers_yillik = [
                "Yıl",
                "Ürün Kodu",
                "Ürün Adı",
                "Toplam Giriş (Adet)",
                "Toplam Giriş Değeri (EUR)",
                "Toplam Giriş Değeri (TL)",
                "Toplam Çıkış (Adet)",
                "Toplam Çıkış Değeri (EUR)",
                "Toplam Çıkış Değeri (TL)",
                "Net Hareket (Adet)",
                "Net Değer (EUR)",
                "Net Değer (TL)",
            ]
            ws_yillik = add_worksheet_with_headers(workbook, "Yıllık Özet", headers_yillik)
            
            query_yillik = """
                SELECT 
                    YEAR(si.Tarih) AS Yil,
                    u.Id AS UrunId,
                    u.UrunKodu,
                    u.UrunAdi,
                    SUM(CASE WHEN si.IslemTipi = 'giris' THEN si.Miktar ELSE 0 END) AS ToplamGiris,
                    SUM(CASE WHEN si.IslemTipi = 'giris' THEN si.Miktar * COALESCE(si.BirimFiyatEUR, 0) ELSE 0 END) AS ToplamGirisEUR,
                    SUM(CASE WHEN si.IslemTipi = 'giris' THEN si.Miktar * COALESCE(si.BirimFiyatTL, 0) ELSE 0 END) AS ToplamGirisTL,
                    SUM(CASE WHEN si.IslemTipi = 'cikis' THEN si.Miktar ELSE 0 END) AS ToplamCikis,
                    SUM(CASE WHEN si.IslemTipi = 'cikis' THEN si.Miktar * COALESCE(si.BirimFiyatEUR, 0) ELSE 0 END) AS ToplamCikisEUR,
                    SUM(CASE WHEN si.IslemTipi = 'cikis' THEN si.Miktar * COALESCE(si.BirimFiyatTL, 0) ELSE 0 END) AS ToplamCikisTL
                FROM StokIslemleri si
                INNER JOIN Urunler u ON si.UrunId = u.Id
                WHERE si.FirmaId = ?
                    AND CONVERT(date, si.Tarih) >= CONVERT(date, ?)
                    AND CONVERT(date, si.Tarih) <= CONVERT(date, ?)
            """
            params_yillik = [firma_id, baslangic_tarihi, bitis_tarihi]
            
            if urun_id:
                query_yillik += " AND si.UrunId = ?"
                params_yillik.append(urun_id)
            
            query_yillik += """
                GROUP BY YEAR(si.Tarih), u.Id, u.UrunKodu, u.UrunAdi
                ORDER BY Yil DESC, u.UrunAdi ASC
            """
            
            yillik_data = db.execute_query(query_yillik, tuple(params_yillik))
            
            row_num = 2
            for yillik in (yillik_data or []):
                toplam_giris = _safe_int(yillik.get("ToplamGiris"))
                toplam_cikis = _safe_int(yillik.get("ToplamCikis"))
                net_hareket = toplam_giris - toplam_cikis
                
                toplam_giris_eur = format_decimal_for_excel(yillik.get("ToplamGirisEUR", 0))
                toplam_giris_tl = format_decimal_for_excel(yillik.get("ToplamGirisTL", 0))
                toplam_cikis_eur = format_decimal_for_excel(yillik.get("ToplamCikisEUR", 0))
                toplam_cikis_tl = format_decimal_for_excel(yillik.get("ToplamCikisTL", 0))
                net_eur = toplam_giris_eur - toplam_cikis_eur
                net_tl = toplam_giris_tl - toplam_cikis_tl
                
                add_data_row(
                    ws_yillik,
                    [
                        yillik.get("Yil", ""),
                        yillik.get("UrunKodu", ""),
                        yillik.get("UrunAdi", ""),
                        toplam_giris,
                        toplam_giris_eur,
                        toplam_giris_tl,
                        toplam_cikis,
                        toplam_cikis_eur,
                        toplam_cikis_tl,
                        net_hareket,
                        net_eur,
                        net_tl,
                    ],
                    row_num,
                )
                row_num += 1
            
            auto_adjust_column_widths(ws_yillik)
            
            # SAYFA 4: Kümülatif Toplamlar
            headers_kumulatif = [
                "Ürün Kodu",
                "Ürün Adı",
                "Başlangıç Stoku",
                "Kümülatif Giriş (Adet)",
                "Kümülatif Çıkış (Adet)",
                "Son Durum Stoku",
                "Kümülatif Değer Değişimi (EUR)",
                "Kümülatif Değer Değişimi (TL)",
            ]
            ws_kumulatif = add_worksheet_with_headers(workbook, "Kümülatif Toplamlar", headers_kumulatif)
            
            # Tüm ürünleri al (kümülatif hesaplama için)
            query_urunler = """
                SELECT Id, UrunKodu, UrunAdi
                FROM Urunler
                WHERE FirmaId = ? AND Aktif = 1
            """
            params_urunler = [firma_id]
            
            if urun_id:
                query_urunler += " AND Id = ?"
                params_urunler.append(urun_id)
            
            query_urunler += " ORDER BY UrunAdi ASC"
            
            tum_urunler = db.execute_query(query_urunler, tuple(params_urunler))
            
            row_num = 2
            for urun in (tum_urunler or []):
                urun_id_key = urun.get("Id")
                
                # Başlangıç stoku: Tarih başlangıcından önceki net hareket
                query_baslangic = """
                    SELECT ISNULL(SUM(
                        CASE 
                            WHEN IslemTipi = 'giris' THEN Miktar 
                            WHEN IslemTipi = 'cikis' THEN -Miktar
                            ELSE 0
                        END
                    ), 0) AS BaslangicStoku
                    FROM StokIslemleri
                    WHERE UrunId = ? AND FirmaId = ? 
                        AND CONVERT(date, Tarih) < CONVERT(date, ?)
                """
                baslangic_result = db.execute_query(
                    query_baslangic,
                    (urun_id_key, firma_id, baslangic_tarihi),
                )
                baslangic_stok = _safe_int(baslangic_result[0].get("BaslangicStoku")) if baslangic_result else 0
                
                # Kümülatif giriş/çıkış (tarih aralığı içinde)
                query_kumulatif = """
                    SELECT 
                        SUM(CASE WHEN IslemTipi = 'giris' THEN Miktar ELSE 0 END) AS KumulatifGiris,
                        SUM(CASE WHEN IslemTipi = 'cikis' THEN Miktar ELSE 0 END) AS KumulatifCikis,
                        SUM(CASE WHEN IslemTipi = 'giris' THEN Miktar * COALESCE(BirimFiyatEUR, 0) ELSE 0 END) - 
                        SUM(CASE WHEN IslemTipi = 'cikis' THEN Miktar * COALESCE(BirimFiyatEUR, 0) ELSE 0 END) AS KumulatifDegerEUR,
                        SUM(CASE WHEN IslemTipi = 'giris' THEN Miktar * COALESCE(BirimFiyatTL, 0) ELSE 0 END) - 
                        SUM(CASE WHEN IslemTipi = 'cikis' THEN Miktar * COALESCE(BirimFiyatTL, 0) ELSE 0 END) AS KumulatifDegerTL
                    FROM StokIslemleri
                    WHERE UrunId = ? AND FirmaId = ?
                        AND CONVERT(date, Tarih) >= CONVERT(date, ?)
                        AND CONVERT(date, Tarih) <= CONVERT(date, ?)
                """
                kumulatif_result = db.execute_query(
                    query_kumulatif,
                    (urun_id_key, firma_id, baslangic_tarihi, bitis_tarihi),
                )
                
                kumulatif_item = kumulatif_result[0] if kumulatif_result else {}
                kumulatif_giris = _safe_int(kumulatif_item.get("KumulatifGiris"))
                kumulatif_cikis = _safe_int(kumulatif_item.get("KumulatifCikis"))
                son_durum = baslangic_stok + kumulatif_giris - kumulatif_cikis
                
                kumulatif_deger_eur = format_decimal_for_excel(kumulatif_item.get("KumulatifDegerEUR", 0))
                kumulatif_deger_tl = format_decimal_for_excel(kumulatif_item.get("KumulatifDegerTL", 0))
                
                add_data_row(
                    ws_kumulatif,
                    [
                        urun.get("UrunKodu", ""),
                        urun.get("UrunAdi", ""),
                        baslangic_stok,
                        kumulatif_giris,
                        kumulatif_cikis,
                        son_durum,
                        kumulatif_deger_eur,
                        kumulatif_deger_tl,
                    ],
                    row_num,
                )
                row_num += 1
            
            auto_adjust_column_widths(ws_kumulatif)
            
            # Dosya adı oluştur
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"stok_raporu_{timestamp}.xlsx"
            
            return save_workbook_to_response(workbook, filename)
            
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)


@reports_ns.route("/personnel")
class PersonnelReport(Resource):
    @jwt_required()
    @require_role("Kontrol Paneli")
    @reports_ns.doc(
        description="Personel hareket raporu Excel formatında",
        security="Bearer",
        params={
            "baslangic_tarihi": {
                "description": "Rapor başlangıç tarihi, format YYYY-MM-DD. Boş bırakılırsa son 1 yıl kullanılır.",
                "type": "string",
                "required": False,
            },
            "bitis_tarihi": {
                "description": "Rapor bitiş tarihi, format YYYY-MM-DD. Boş bırakılırsa son 1 yıl kullanılır.",
                "type": "string",
                "required": False,
            },
            "kullanici_id": {
                "description": "Personel ID filtresi. Gönderilmezse tüm personel dahil edilir.",
                "type": "integer",
                "required": False,
            },
        },
    )
    def get(self):
        """Personel hareket raporu oluşturur ve Excel dosyası olarak döndürür."""
        try:
            firma_id = get_current_firma_id()
            if not firma_id:
                return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", 401)

            # Tarih aralığını al
            baslangic_tarihi = _parse_date(request.args.get("baslangic_tarihi"))
            bitis_tarihi = _parse_date(request.args.get("bitis_tarihi"))
            
            if not baslangic_tarihi or not bitis_tarihi:
                baslangic_tarihi, bitis_tarihi = _get_default_date_range()
            
            # Tarih aralığı kontrolü
            if baslangic_tarihi > bitis_tarihi:
                return error_response(
                    "VALIDATION_ERROR",
                    "Başlangıç tarihi bitiş tarihinden sonra olamaz",
                    400,
                )
            
            kullanici_id = _parse_optional_int(request.args.get("kullanici_id"))
            
            # Excel workbook oluştur
            workbook = create_excel_workbook()
            
            # SAYFA 1: Personel Özet
            headers_ozet = [
                "Personel Adı Soyadı",
                "Toplam İşlem Sayısı",
                "Giriş İşlem Sayısı",
                "Çıkış İşlem Sayısı",
                "Transfer İşlem Sayısı",
                "Toplam İşlem Miktarı",
            ]
            ws_ozet = add_worksheet_with_headers(workbook, "Personel Özet", headers_ozet)
            
            query_ozet = """
                SELECT 
                    k.Id AS KullaniciId,
                    k.AdSoyad,
                    COUNT(*) AS ToplamIslemSayisi,
                    SUM(CASE WHEN si.IslemTipi = 'giris' THEN 1 ELSE 0 END) AS GirisSayisi,
                    SUM(CASE WHEN si.IslemTipi = 'cikis' THEN 1 ELSE 0 END) AS CikisSayisi,
                    SUM(CASE WHEN si.IslemTipi = 'transfer' THEN 1 ELSE 0 END) AS TransferSayisi,
                    SUM(si.Miktar) AS ToplamMiktar
                FROM StokIslemleri si
                INNER JOIN Kullanicilar k ON si.KullaniciId = k.Id
                WHERE si.FirmaId = ?
                    AND CONVERT(date, si.Tarih) >= CONVERT(date, ?)
                    AND CONVERT(date, si.Tarih) <= CONVERT(date, ?)
            """
            params_ozet = [firma_id, baslangic_tarihi, bitis_tarihi]
            
            if kullanici_id:
                query_ozet += " AND k.Id = ?"
                params_ozet.append(kullanici_id)
            
            query_ozet += """
                GROUP BY k.Id, k.AdSoyad
                ORDER BY k.AdSoyad ASC
            """
            
            ozet_data = db.execute_query(query_ozet, tuple(params_ozet))
            
            row_num = 2
            for ozet in (ozet_data or []):
                add_data_row(
                    ws_ozet,
                    [
                        ozet.get("AdSoyad", ""),
                        _safe_int(ozet.get("ToplamIslemSayisi")),
                        _safe_int(ozet.get("GirisSayisi")),
                        _safe_int(ozet.get("CikisSayisi")),
                        _safe_int(ozet.get("TransferSayisi")),
                        _safe_int(ozet.get("ToplamMiktar")),
                    ],
                    row_num,
                )
                row_num += 1
            
            auto_adjust_column_widths(ws_ozet)
            
            # SAYFA 2: Haftalık İşlem Özeti
            headers_haftalik = [
                "Hafta",
                "Personel Adı Soyadı",
                "İşlem Sayısı",
                "Giriş Sayısı",
                "Çıkış Sayısı",
                "Transfer Sayısı",
            ]
            ws_haftalik = add_worksheet_with_headers(workbook, "Haftalık Özet", headers_haftalik)
            
            query_haftalik = """
                SELECT 
                    DATEPART(YEAR, si.Tarih) AS Yil,
                    DATEPART(WEEK, si.Tarih) AS Hafta,
                    k.AdSoyad,
                    COUNT(*) AS IslemSayisi,
                    SUM(CASE WHEN si.IslemTipi = 'giris' THEN 1 ELSE 0 END) AS GirisSayisi,
                    SUM(CASE WHEN si.IslemTipi = 'cikis' THEN 1 ELSE 0 END) AS CikisSayisi,
                    SUM(CASE WHEN si.IslemTipi = 'transfer' THEN 1 ELSE 0 END) AS TransferSayisi
                FROM StokIslemleri si
                INNER JOIN Kullanicilar k ON si.KullaniciId = k.Id
                WHERE si.FirmaId = ?
                    AND CONVERT(date, si.Tarih) >= CONVERT(date, ?)
                    AND CONVERT(date, si.Tarih) <= CONVERT(date, ?)
            """
            params_haftalik = [firma_id, baslangic_tarihi, bitis_tarihi]
            
            if kullanici_id:
                query_haftalik += " AND k.Id = ?"
                params_haftalik.append(kullanici_id)
            
            query_haftalik += """
                GROUP BY DATEPART(YEAR, si.Tarih), DATEPART(WEEK, si.Tarih), k.Id, k.AdSoyad
                ORDER BY Yil DESC, Hafta DESC, k.AdSoyad ASC
            """
            
            haftalik_data = db.execute_query(query_haftalik, tuple(params_haftalik))
            
            row_num = 2
            for haftalik in (haftalik_data or []):
                hafta_str = f"{haftalik.get('Yil', '')}-W{str(haftalik.get('Hafta', '')).zfill(2)}"
                add_data_row(
                    ws_haftalik,
                    [
                        hafta_str,
                        haftalik.get("AdSoyad", ""),
                        _safe_int(haftalik.get("IslemSayisi")),
                        _safe_int(haftalik.get("GirisSayisi")),
                        _safe_int(haftalik.get("CikisSayisi")),
                        _safe_int(haftalik.get("TransferSayisi")),
                    ],
                    row_num,
                )
                row_num += 1
            
            auto_adjust_column_widths(ws_haftalik)
            
            # SAYFA 3: Aylık İşlem Özeti
            headers_aylik = [
                "Ay",
                "Personel Adı Soyadı",
                "İşlem Sayısı",
                "Giriş Sayısı",
                "Çıkış Sayısı",
                "Transfer Sayısı",
            ]
            ws_aylik = add_worksheet_with_headers(workbook, "Aylık Özet", headers_aylik)
            
            query_aylik = """
                SELECT 
                    YEAR(si.Tarih) AS Yil,
                    MONTH(si.Tarih) AS Ay,
                    k.AdSoyad,
                    COUNT(*) AS IslemSayisi,
                    SUM(CASE WHEN si.IslemTipi = 'giris' THEN 1 ELSE 0 END) AS GirisSayisi,
                    SUM(CASE WHEN si.IslemTipi = 'cikis' THEN 1 ELSE 0 END) AS CikisSayisi,
                    SUM(CASE WHEN si.IslemTipi = 'transfer' THEN 1 ELSE 0 END) AS TransferSayisi
                FROM StokIslemleri si
                INNER JOIN Kullanicilar k ON si.KullaniciId = k.Id
                WHERE si.FirmaId = ?
                    AND CONVERT(date, si.Tarih) >= CONVERT(date, ?)
                    AND CONVERT(date, si.Tarih) <= CONVERT(date, ?)
            """
            params_aylik = [firma_id, baslangic_tarihi, bitis_tarihi]
            
            if kullanici_id:
                query_aylik += " AND k.Id = ?"
                params_aylik.append(kullanici_id)
            
            query_aylik += """
                GROUP BY YEAR(si.Tarih), MONTH(si.Tarih), k.Id, k.AdSoyad
                ORDER BY Yil DESC, Ay DESC, k.AdSoyad ASC
            """
            
            aylik_data = db.execute_query(query_aylik, tuple(params_aylik))
            
            row_num = 2
            for aylik in (aylik_data or []):
                ay_str = f"{aylik.get('Yil', '')}-{str(aylik.get('Ay', '')).zfill(2)}"
                add_data_row(
                    ws_aylik,
                    [
                        ay_str,
                        aylik.get("AdSoyad", ""),
                        _safe_int(aylik.get("IslemSayisi")),
                        _safe_int(aylik.get("GirisSayisi")),
                        _safe_int(aylik.get("CikisSayisi")),
                        _safe_int(aylik.get("TransferSayisi")),
                    ],
                    row_num,
                )
                row_num += 1
            
            auto_adjust_column_widths(ws_aylik)
            
            # SAYFA 4: Yıllık İşlem Özeti
            headers_yillik = [
                "Yıl",
                "Personel Adı Soyadı",
                "İşlem Sayısı",
                "Giriş Sayısı",
                "Çıkış Sayısı",
                "Transfer Sayısı",
            ]
            ws_yillik = add_worksheet_with_headers(workbook, "Yıllık Özet", headers_yillik)
            
            query_yillik = """
                SELECT 
                    YEAR(si.Tarih) AS Yil,
                    k.AdSoyad,
                    COUNT(*) AS IslemSayisi,
                    SUM(CASE WHEN si.IslemTipi = 'giris' THEN 1 ELSE 0 END) AS GirisSayisi,
                    SUM(CASE WHEN si.IslemTipi = 'cikis' THEN 1 ELSE 0 END) AS CikisSayisi,
                    SUM(CASE WHEN si.IslemTipi = 'transfer' THEN 1 ELSE 0 END) AS TransferSayisi
                FROM StokIslemleri si
                INNER JOIN Kullanicilar k ON si.KullaniciId = k.Id
                WHERE si.FirmaId = ?
                    AND CONVERT(date, si.Tarih) >= CONVERT(date, ?)
                    AND CONVERT(date, si.Tarih) <= CONVERT(date, ?)
            """
            params_yillik = [firma_id, baslangic_tarihi, bitis_tarihi]
            
            if kullanici_id:
                query_yillik += " AND k.Id = ?"
                params_yillik.append(kullanici_id)
            
            query_yillik += """
                GROUP BY YEAR(si.Tarih), k.Id, k.AdSoyad
                ORDER BY Yil DESC, k.AdSoyad ASC
            """
            
            yillik_data = db.execute_query(query_yillik, tuple(params_yillik))
            
            row_num = 2
            for yillik in (yillik_data or []):
                add_data_row(
                    ws_yillik,
                    [
                        yillik.get("Yil", ""),
                        yillik.get("AdSoyad", ""),
                        _safe_int(yillik.get("IslemSayisi")),
                        _safe_int(yillik.get("GirisSayisi")),
                        _safe_int(yillik.get("CikisSayisi")),
                        _safe_int(yillik.get("TransferSayisi")),
                    ],
                    row_num,
                )
                row_num += 1
            
            auto_adjust_column_widths(ws_yillik)
            
            # SAYFA 5: Günlük Çalışma Saatleri
            headers_saatler = [
                "Tarih",
                "Personel Adı Soyadı",
                "İlk İşlem Saati",
                "Son İşlem Saati",
                "Çalışma Süresi (Saat:Dakika)",
                "Toplam İşlem Sayısı",
            ]
            ws_saatler = add_worksheet_with_headers(workbook, "Günlük Çalışma Saatleri", headers_saatler)
            
            query_saatler = """
                SELECT 
                    CONVERT(date, si.Tarih) AS Tarih,
                    k.AdSoyad,
                    MIN(si.Tarih) AS IlkIslemSaati,
                    MAX(si.Tarih) AS SonIslemSaati,
                    COUNT(*) AS ToplamIslemSayisi
                FROM StokIslemleri si
                INNER JOIN Kullanicilar k ON si.KullaniciId = k.Id
                WHERE si.FirmaId = ?
                    AND CONVERT(date, si.Tarih) >= CONVERT(date, ?)
                    AND CONVERT(date, si.Tarih) <= CONVERT(date, ?)
            """
            params_saatler = [firma_id, baslangic_tarihi, bitis_tarihi]
            
            if kullanici_id:
                query_saatler += " AND k.Id = ?"
                params_saatler.append(kullanici_id)
            
            query_saatler += """
                GROUP BY CONVERT(date, si.Tarih), k.Id, k.AdSoyad
                ORDER BY Tarih DESC, k.AdSoyad ASC
            """
            
            saatler_data = db.execute_query(query_saatler, tuple(params_saatler))
            
            row_num = 2
            for saatler in (saatler_data or []):
                ilk_saat = saatler.get("IlkIslemSaati")
                son_saat = saatler.get("SonIslemSaati")
                
                calisma_suresi = ""
                if ilk_saat and son_saat:
                    if isinstance(ilk_saat, datetime) and isinstance(son_saat, datetime):
                        fark = son_saat - ilk_saat
                        toplam_saniye = int(fark.total_seconds())
                        saat = toplam_saniye // 3600
                        dakika = (toplam_saniye % 3600) // 60
                        calisma_suresi = f"{saat}:{str(dakika).zfill(2)}"
                
                tarih_value = saatler.get("Tarih")
                if isinstance(tarih_value, datetime):
                    tarih_str = tarih_value.strftime("%Y-%m-%d")
                else:
                    tarih_str = format_date_for_excel(tarih_value)
                
                ilk_saat_str = format_date_for_excel(ilk_saat)
                son_saat_str = format_date_for_excel(son_saat)
                
                add_data_row(
                    ws_saatler,
                    [
                        tarih_str,
                        saatler.get("AdSoyad", ""),
                        ilk_saat_str,
                        son_saat_str,
                        calisma_suresi,
                        _safe_int(saatler.get("ToplamIslemSayisi")),
                    ],
                    row_num,
                )
                row_num += 1
            
            auto_adjust_column_widths(ws_saatler)
            
            # SAYFA 6: İşlem Detayları
            headers_detay = [
                "Tarih",
                "Saat",
                "Personel Adı Soyadı",
                "İşlem Tipi",
                "Ürün Kodu",
                "Ürün Adı",
                "Miktar",
                "Açıklama",
            ]
            ws_detay = add_worksheet_with_headers(workbook, "İşlem Detayları", headers_detay)
            
            query_detay = """
                SELECT 
                    si.Tarih,
                    k.AdSoyad,
                    CASE 
                        WHEN si.IslemTipi = 'giris' THEN 'Giriş'
                        WHEN si.IslemTipi = 'cikis' THEN 'Çıkış'
                        WHEN si.IslemTipi = 'transfer' THEN 'Transfer'
                        ELSE si.IslemTipi
                    END AS IslemTipi,
                    u.UrunKodu,
                    u.UrunAdi,
                    si.Miktar,
                    si.Aciklama
                FROM StokIslemleri si
                INNER JOIN Kullanicilar k ON si.KullaniciId = k.Id
                INNER JOIN Urunler u ON si.UrunId = u.Id
                WHERE si.FirmaId = ?
                    AND CONVERT(date, si.Tarih) >= CONVERT(date, ?)
                    AND CONVERT(date, si.Tarih) <= CONVERT(date, ?)
            """
            params_detay = [firma_id, baslangic_tarihi, bitis_tarihi]
            
            if kullanici_id:
                query_detay += " AND k.Id = ?"
                params_detay.append(kullanici_id)
            
            query_detay += " ORDER BY si.Tarih DESC, k.AdSoyad ASC"
            
            detay_data = db.execute_query(query_detay, tuple(params_detay))
            
            row_num = 2
            for detay in (detay_data or []):
                tarih_value = detay.get("Tarih")
                if isinstance(tarih_value, datetime):
                    tarih_str = tarih_value.strftime("%Y-%m-%d")
                    saat_str = tarih_value.strftime("%H:%M:%S")
                else:
                    tarih_str = format_date_for_excel(tarih_value)
                    saat_str = ""
                
                add_data_row(
                    ws_detay,
                    [
                        tarih_str,
                        saat_str,
                        detay.get("AdSoyad", ""),
                        detay.get("IslemTipi", ""),
                        detay.get("UrunKodu", ""),
                        detay.get("UrunAdi", ""),
                        _safe_int(detay.get("Miktar")),
                        detay.get("Aciklama", ""),
                    ],
                    row_num,
                )
                row_num += 1
            
            auto_adjust_column_widths(ws_detay)
            
            # Dosya adı oluştur
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"personel_raporu_{timestamp}.xlsx"
            
            return save_workbook_to_response(workbook, filename)
            
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)
