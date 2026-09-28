"""
Sayfalama yardımcıları (page/limit).

- page: 1-based
- limit: varsayılan 100 (max 500)
"""

from __future__ import annotations

from math import ceil
from typing import Any, Mapping, Tuple


def parse_limit(
    args: Mapping[str, Any],
    default_limit: int = 100,
    max_limit: int = 5000,
) -> int:
    """
    Basit listeleme için sadece limit okur.
    Kullanıcı sadece kaç kayıt istiyorsa onu yazar: ?limit=1000
    """
    limit_raw = args.get("limit", default_limit)
    try:
        limit = int(limit_raw)
    except Exception:
        limit = default_limit
    return max(1, min(max_limit, limit))


def parse_pagination(
    args: Mapping[str, Any],
    default_limit: int = 100,
    max_limit: int = 500,
) -> Tuple[int, int, int]:
    """
    Dönüş: (page, limit, offset)
    - args içinde page veya sayfa; limit parametrelerini okur.
    """
    page_raw = args.get("page", args.get("sayfa", 1))
    limit_raw = args.get("limit", default_limit)

    try:
        page = int(page_raw)
    except Exception:
        page = 1
    try:
        limit = int(limit_raw)
    except Exception:
        limit = default_limit

    page = max(1, page)
    limit = max(1, min(max_limit, limit))
    offset = (page - 1) * limit
    return page, limit, offset


def build_pagination(page: int, limit: int, total_count: int) -> dict:
    total_count = max(0, int(total_count or 0))
    total_pages = max(1, int(ceil(total_count / limit))) if limit else 1
    has_more = page < total_pages
    return {
        "sayfa": page,
        "limit": limit,
        "toplam_kayit": total_count,
        "toplam_sayfa": total_pages,
        "has_more": has_more,
    }


