"""
FX (Döviz) yardımcıları.

- EURTRY kuru harici API'den çekilir
- Aynı gün için DB'de cache'lenir (dbo.DovizKurlari)
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Optional

import os
import requests
import logging

from database import db

logger = logging.getLogger(__name__)

def _env(name: str, default: str = "") -> str:
    return (os.getenv(name, default) or "").strip()

def _is_missing_table_error(exc: Exception) -> bool:
    # pyodbc SQLSTATE 42S02 -> invalid object name / table not found
    try:
        msg = str(exc) or ""
        return "42S02" in msg and "DovizKurlari" in msg
    except Exception:
        return False


def _to_decimal(v: Any) -> Decimal:
    if isinstance(v, Decimal):
        return v
    if v is None:
        raise ValueError("Kur değeri boş olamaz")
    try:
        return Decimal(str(v))
    except (InvalidOperation, ValueError) as e:
        raise ValueError(f"Geçersiz kur değeri: {v!r}") from e


def _quantize(value: Decimal, scale: int) -> Decimal:
    q = Decimal("1." + ("0" * scale))
    return value.quantize(q, rounding=ROUND_HALF_UP)


def get_eur_try_rate(target_date: Optional[date] = None) -> tuple[Decimal, date]:
    """
    EUR -> TRY kuru döner.

    Dönüş: (eurtry, rate_date)
    - Önce dbo.DovizKurlari tablosunda target_date için arar
    - Yoksa harici API'den çeker ve dbo.DovizKurlari'na yazar
    - Harici API başarısız olursa son bilinen kuru (en son tarih) kullanır (varsa)
    """
    d = target_date or date.today()

    try:
        cached = db.execute_query(
            "SELECT TOP 1 EURTRY FROM DovizKurlari WHERE Tarih = ?",
            (d,),
        )
    except Exception as exc:
        if _is_missing_table_error(exc):
            raise RuntimeError(
                "DB şeması eksik: 'dbo.DovizKurlari' tablosu bulunamadı. "
                "Lütfen db/2025-12_fiyat_kur_pagination.sql scriptini ABWareDB üzerinde çalıştır."
            ) from exc
        raise
    if cached:
        return _quantize(_to_decimal(cached[0]["EURTRY"]), 8), d

    # Default provider: Frankfurter (key gerektirmez)
    # Örn: https://api.frankfurter.app/latest?from=EUR&to=TRY  -> { rates: { TRY: 55.12 }, date: ... }
    url = _env("FX_EURTRY_URL", "https://api.frankfurter.app/latest?from=EUR&to=TRY")
    timeout = int(_env("FX_TIMEOUT_SECONDS", "10") or "10")

    eurtry: Optional[Decimal] = None
    try:
        resp = requests.get(url, timeout=timeout, headers={"User-Agent": "ABWare-Backend/1.0"})
        resp.raise_for_status()
        payload = resp.json()
        # Desteklenen formatlar:
        # - { "rates": { "TRY": 55.1234 }, ... }  (frankfurter, exchangerate.host)
        # - { "conversion_rates": { "TRY": 55.1234 }, ... } (bazı provider'lar)
        rates = (payload or {}).get("rates") or (payload or {}).get("conversion_rates") or {}
        eurtry = _to_decimal((rates or {}).get("TRY"))
        eurtry = _quantize(eurtry, 8)
    except Exception as exc:
        logger.warning("EURTRY internetten alınamadı (url=%s): %s", url, exc, exc_info=True)
        eurtry = None

    if eurtry is None:
        # Son bilinen kur (fallback)
        try:
            last = db.execute_query("SELECT TOP 1 Tarih, EURTRY FROM DovizKurlari ORDER BY Tarih DESC")
        except Exception as exc:
            if _is_missing_table_error(exc):
                raise RuntimeError(
                    "DB şeması eksik: 'dbo.DovizKurlari' tablosu bulunamadı. "
                    "Lütfen db/2025-12_fiyat_kur_pagination.sql scriptini ABWareDB üzerinde çalıştır."
                ) from exc
            raise
        if last:
            return _quantize(_to_decimal(last[0]["EURTRY"]), 8), last[0]["Tarih"]
        raise RuntimeError("EURTRY kuru alınamadı ve DB'de önceki kur bulunamadı")

    # Cache insert (race condition olursa ignore + reselect)
    try:
        db.execute_query(
            "INSERT INTO DovizKurlari (Tarih, EURTRY, Kaynak) VALUES (?, ?, ?)",
            (d, eurtry, url),
            fetch=False,
        )
    except Exception:
        # Unique index yarışında tekrar oku
        cached2 = None
        try:
            cached2 = db.execute_query(
                "SELECT TOP 1 EURTRY FROM DovizKurlari WHERE Tarih = ?",
                (d,),
            )
        except Exception as exc:
            if _is_missing_table_error(exc):
                raise RuntimeError(
                    "DB şeması eksik: 'dbo.DovizKurlari' tablosu bulunamadı. "
                    "Lütfen db/2025-12_fiyat_kur_pagination.sql scriptini ABWareDB üzerinde çalıştır."
                ) from exc
            raise
        if cached2:
            return _quantize(_to_decimal(cached2[0]["EURTRY"]), 8), d
        raise

    return eurtry, d


def tl_to_eur(tl: Decimal, eurtry: Decimal) -> Decimal:
    """
    TL -> EUR: tl / eurtry
    (ürün fiyatı için)
    """
    if eurtry <= 0:
        raise ValueError("Kur 0'dan büyük olmalıdır")
    return _quantize((tl / eurtry), 6)


def eur_to_tl(eur: Decimal, eurtry: Decimal) -> Decimal:
    """
    EUR -> TL: eur * eurtry
    (stok hareket birim TL fiyatı için)
    """
    if eurtry <= 0:
        raise ValueError("Kur 0'dan büyük olmalıdır")
    return _quantize((eur * eurtry), 4)


