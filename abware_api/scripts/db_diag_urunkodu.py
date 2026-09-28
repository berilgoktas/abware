from __future__ import annotations

"""
DB teşhis aracı (lokal kullanım):
- Urunler.UrunKodu computed mı?
- Urunler tablosunda trigger var mı?
- Basit bir UPDATE ile UrunKodu değişiyor mu?

Kullanım:
  python scripts/db_diag_urunkodu.py
"""

from database import db


def main() -> None:
    computed = db.execute_query(
        "SELECT COLUMNPROPERTY(OBJECT_ID('dbo.Urunler'),'UrunKodu','IsComputed') AS IsComputed"
    )
    print("computed:", computed[0] if computed else None)

    triggers = db.execute_query(
        "SELECT name, is_disabled, is_instead_of_trigger FROM sys.triggers WHERE parent_id = OBJECT_ID('dbo.Urunler')"
    )
    print("triggers:", triggers)

    rows = db.execute_query("SELECT TOP 1 Id, FirmaId, UrunKodu FROM Urunler ORDER BY Id DESC")
    if not rows:
        print("No product rows found.")
        return

    row = rows[0]
    print("sample_before:", row)

    new_code = "TESTCODE-XYZ"
    rc = db.execute_query(
        "UPDATE Urunler SET UrunKodu = ? WHERE Id = ? AND FirmaId = ?",
        (new_code, row["Id"], row["FirmaId"]),
        fetch=False,
    )
    print("update_rowcount:", rc)

    after = db.execute_query("SELECT TOP 1 Id, FirmaId, UrunKodu FROM Urunler WHERE Id = ?", (row["Id"],))
    print("sample_after:", after[0] if after else None)


if __name__ == "__main__":
    main()




