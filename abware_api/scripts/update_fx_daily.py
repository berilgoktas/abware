"""
Günlük EURTRY kur güncellemesi (DovizKurlari).

İstenen davranış:
- DovizKurlari tablosundaki en büyük Tarih bugün ile aynıysa: çekme/ekleme yapma
- Bugünden küçükse: harici API'den çek ve bugün için kaydı oluştur

Not: Bu scripti Windows Task Scheduler ile her gün 16:40'da çalıştırabilirsin.
"""

from __future__ import annotations

from datetime import date
import sys
from pathlib import Path

# Proje kökünü sys.path'e ekle (script scripts/ altından çalıştırılabilir)
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from database import db
from utils.fx import get_eur_try_rate


def _get_max_date() -> date | None:
    rows = db.execute_query("SELECT MAX(Tarih) AS MaxTarih FROM DovizKurlari")
    if not rows:
        return None
    v = rows[0].get("MaxTarih")
    # database.py zaten date/datetime isoformat string'e çevirebiliyor; her durumu destekle
    if v is None:
        return None
    if isinstance(v, date):
        return v
    # ISO date string: "2025-12-26"
    try:
        return date.fromisoformat(str(v)[:10])
    except Exception:
        return None


def main() -> int:
    today = date.today()
    max_d = _get_max_date()

    if max_d is not None and max_d >= today:
        print(f"[fx] Zaten güncel. max_tarih={max_d} bugün={today} -> işlem yok")
        return 0

    rate, d = get_eur_try_rate(today)
    if d != today:
        # get_eur_try_rate API başarısız olunca son bilinen kuru döndürebilir.
        # Günlük job için bu kabul edilmesin: bugünün kaydı mutlaka bugünün kuru olmalı.
        print(f"[fx] HATA: Bugünün kuru alınamadı. dönen_tarih={d} bugün={today} (EURTRY={rate})")
        return 2

    print(f"[fx] Güncellendi. tarih={d} EURTRY={rate}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


