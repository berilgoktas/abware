"""
Audit / log yardımcıları.

`IslemGecmisi` tablosuna uygulama seviyesinde log kaydı atmak için kullanılır.
"""

import json
from datetime import datetime, date
from typing import Any, Optional

from flask import request
from flask_jwt_extended import get_jwt_identity, get_jwt

from database import db


def _to_int(value: Any) -> Optional[int]:
    """Değeri güvenli bir şekilde integer'a çevirir."""
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _serialize_value(value: Any) -> Any:
    """JSON'a serileştirilebilir tipe dönüştürür."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _to_json(data: Optional[dict]) -> Optional[str]:
    """Dict'i JSON string'e çevirir (opsiyonel)."""
    if not data:
        return None
    safe = {k: _serialize_value(v) for k, v in data.items()}
    return json.dumps(safe, ensure_ascii=False, default=str)


def log_action(
    islem_tipi: str,
    aciklama: str,
    urun_id: Optional[int] = None,
    eski_deger: Optional[dict] = None,
    yeni_deger: Optional[dict] = None,
) -> None:
    """`IslemGecmisi` tablosuna log kaydı yazar.

    islem_tipi: 'urun_ekleme', 'urun_guncelleme', 'stok_giris', vb.
    aciklama: Kullanıcıya gösterilecek açıklama
    urun_id: İlgili ürün ID'si (opsiyonel)
    eski_deger / yeni_deger: JSON olarak saklanacak dict'ler (opsiyonel)
    """
    try:
        user_id = _to_int(get_jwt_identity())
        claims = get_jwt()
        firma_id = _to_int(claims.get("firma_id")) if claims else None
        ip_adresi = getattr(request, "remote_addr", None)
        user_agent = request.headers.get("User-Agent") if request else None

        eski_json = _to_json(eski_deger)
        yeni_json = _to_json(yeni_deger)

        query = (
            "INSERT INTO IslemGecmisi (FirmaId, IslemTipi, Aciklama, KullaniciId, "
            "UrunId, EskiDeger, YeniDeger, Tarih, IpAdresi, UserAgent) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()), ?, ?)"
        )

        params = (
            firma_id,
            islem_tipi,
            aciklama,
            user_id,
            urun_id,
            eski_json,
            yeni_json,
            ip_adresi,
            user_agent,
        )

        # fetch=False -> commit + rowcount döner; sonucu kullanmıyoruz
        db.execute_query(query, params, fetch=False)
    except Exception:
        # Log alınamazsa ana akışı bozmamak için hatayı yutuyoruz.
        pass


