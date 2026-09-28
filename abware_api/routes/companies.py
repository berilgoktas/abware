"""
Firma yönetimi endpoint'leri.

Yalnızca sistem süper admin veya SUPER_ADMIN rolü olan kullanıcılar erişebilir:
- Firma listesi
- Yeni firma ekleme
- Yeni firmalara admin kullanıcı ekleme
"""

from flask import request
from flask_restx import Namespace, Resource, fields
from flask_jwt_extended import jwt_required

from database import db
from middleware.auth import require_super_admin
from utils.password import hash_password
from utils.responses import success_response, error_response
from utils.pagination import parse_limit


companies_ns = Namespace("companies", description="Firma yönetimi (sistem süper admin veya SUPER_ADMIN)")


def _role_ids_by_names(role_names: list[str]) -> list[int]:
    """
    Verilen rol adlarına göre Roller tablosundan Id listesi döndürür (case-insensitive).
    """
    if not role_names:
        return []
    # TR collation farklılıkları için CI_AI ile karşılaştır
    placeholders = ",".join(["?"] * len(role_names))
    rows = db.execute_query(
        f"""
        SELECT Id, Ad
        FROM Roller
        WHERE Ad COLLATE Latin1_General_100_CI_AI IN ({placeholders})
        """,
        tuple(role_names),
    )
    found = {str(r["Ad"]).strip(): int(r["Id"]) for r in (rows or [])}
    missing = [rn for rn in role_names if rn not in found]
    if missing:
        raise ValueError(f"Rol(ler) bulunamadı: {missing}")
    return [found[rn] for rn in role_names]


company_model = companies_ns.model(
    "Company",
    {
        "id": fields.Integer(readonly=True, description="Firma ID"),
        "kod": fields.String(required=True, description="Firma kodu (benzersiz, login'de kullanılacak)"),
        "ad": fields.String(required=True, description="Firma adı"),
        "aciklama": fields.String(required=False, description="Firma açıklaması"),
        "aktif": fields.Boolean(description="Aktif mi?"),
        "olusturma_tarihi": fields.String(description="Oluşturulma tarihi"),
    },
)

company_admin_user_model = companies_ns.model(
    "CompanyAdminUserCreate",
    {
        "kullanici_adi": fields.String(required=True, description="Kullanıcı adı"),
        "sifre": fields.String(required=True, description="Şifre (min 6 karakter)"),
        "ad_soyad": fields.String(required=True, description="Ad Soyad"),
        "email": fields.String(required=False, description="E-posta"),
        "aktif": fields.Boolean(required=False, description="Aktif mi? (default: true)", default=True),
    },
)

company_status_model = companies_ns.model(
    "CompanyStatusUpdate",
    {
        "aktif": fields.Boolean(required=True, description="Firma aktif mi? (true/false)"),
    },
)


@companies_ns.route("")
class Companies(Resource):
    @jwt_required()
    @require_super_admin
    @companies_ns.doc(
        description="Tüm firmaları listeler (sadece süper admin)",
        security="Bearer",
        params={
            "limit": {"description": "Kaç kayıt gelsin? (default 100, max 5000)", "type": "integer", "default": 100},
        },
    )
    def get(self):
        """Tüm firmaların listesini döndürür."""
        try:
            limit = parse_limit(request.args, default_limit=100, max_limit=5000)

            rows = db.execute_query(
                """
                SELECT TOP (?)
                    Id,
                    Kod,
                    Ad,
                    Aciklama,
                    Aktif,
                    OlusturmaTarihi
                FROM Firmalar
                ORDER BY Ad ASC
                """,
                (limit,),
            )
            # marshal_with için doğrudan liste döndür
            mapped = [
                {
                    "id": r["Id"],
                    "kod": r["Kod"],
                    "ad": r["Ad"],
                    "aciklama": r["Aciklama"],
                    "aktif": bool(r["Aktif"]),
                    "olusturma_tarihi": r["OlusturmaTarihi"],
                }
                for r in rows
            ]
            data = {"firmalar": mapped, "sayfalama": {"limit": limit, "donen": len(mapped)}}
            return success_response(data, status_code=200)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)

    @jwt_required()
    @require_super_admin
    @companies_ns.expect(
        companies_ns.model(
            "CompanyCreate",
            {
                "kod": fields.String(required=True, description="Firma kodu (örn: FIRMA1)"),
                "ad": fields.String(required=True, description="Firma adı"),
                "aciklama": fields.String(required=False, description="Açıklama"),
                "aktif": fields.Boolean(required=False, description="Aktif mi? (default: true)"),
            },
        ),
        validate=True,
    )
    @companies_ns.marshal_with(company_model, code=201)
    @companies_ns.doc(description="Yeni firma ekler (sadece süper admin)", security="Bearer")
    def post(self):
        """Yeni firma ekler (sadece süper admin)."""
        body = request.get_json() or {}
        kod = (body.get("kod") or "").strip()
        ad = (body.get("ad") or "").strip()
        aciklama = (body.get("aciklama") or "").strip() or None
        aktif = body.get("aktif", True)

        if not kod or not ad:
            return error_response(
                "VALIDATION_ERROR",
                "kod ve ad alanları zorunludur",
                400,
            )

        try:
            # Kod benzersiz mi?
            exists = db.execute_query(
                "SELECT COUNT(*) AS Sayi FROM Firmalar WHERE Kod = ?",
                (kod,),
            )
            if exists and exists[0].get("Sayi", 0) > 0:
                return error_response(
                    "DUPLICATE_COMPANY",
                    "Bu firma kodu zaten kullanılıyor",
                    400,
                )

            conn = db.get_connection()
            cursor = conn.cursor()
            insert_sql = """
                INSERT INTO Firmalar (Kod, Ad, Aciklama, Aktif, OlusturmaTarihi)
                OUTPUT INSERTED.Id, INSERTED.Kod, INSERTED.Ad, INSERTED.Aciklama,
                       INSERTED.Aktif, INSERTED.OlusturmaTarihi
                VALUES (?, ?, ?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()))
            """
            cursor.execute(insert_sql, (kod, ad, aciklama, 1 if aktif else 0))
            row = cursor.fetchone()
            conn.commit()
            cursor.close()

            created = {
                "id": row[0],
                "kod": row[1],
                "ad": row[2],
                "aciklama": row[3],
                "aktif": bool(row[4]),
                "olusturma_tarihi": row[5],
            }
            return created, 201
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)


@companies_ns.route("/<int:firma_id>/admin-kullanici")
class CompanyAdminUser(Resource):
    @jwt_required()
    @require_super_admin
    @companies_ns.expect(company_admin_user_model, validate=True)
    @companies_ns.doc(
        description="Seçilen firmaya Admin kullanıcı ekler (sistem süper admin veya SUPER_ADMIN)",
        security="Bearer",
    )
    def post(self, firma_id: int):
        """
        Yeni firmalar için başlangıç Admin kullanıcısı ekleme.

        Notlar:
        - Kullanıcı firma bazlıdır (Kullanicilar.FirmaId = firma_id)
        - Rol, Roller tablosundan 'Admin' adı ile bulunur ve atanır.
        """
        body = request.get_json() or {}
        kullanici_adi = (body.get("kullanici_adi") or "").strip()
        sifre = body.get("sifre")
        ad_soyad = (body.get("ad_soyad") or "").strip()
        email = (body.get("email") or "").strip() or None
        aktif = body.get("aktif", True)

        if not kullanici_adi or not sifre or not ad_soyad:
            return error_response(
                "VALIDATION_ERROR",
                "kullanici_adi, sifre ve ad_soyad zorunludur",
                400,
            )
        if len(str(sifre)) < 6:
            return error_response("VALIDATION_ERROR", "Şifre en az 6 karakter olmalıdır", 400)

        try:
            # Firma var mı?
            firma = db.execute_query("SELECT TOP 1 Id, Kod, Ad, Aktif FROM Firmalar WHERE Id = ?", (int(firma_id),))
            if not firma:
                return error_response("COMPANY_NOT_FOUND", "Firma bulunamadı", 404)

            # Yeni model: kullanıcıya RolId yazmıyoruz; KullaniciRolleri tablosuna rol ekliyoruz.
            # Başlangıç admin kullanıcısı için: Roller tablosundaki TÜM rolleri ver.
            role_rows = db.execute_query("SELECT Id, Ad FROM Roller ORDER BY Id ASC")
            role_ids = [int(r["Id"]) for r in (role_rows or []) if r.get("Id") is not None]
            if not role_ids:
                return error_response(
                    "VALIDATION_ERROR",
                    "Rol bulunamadı. Roller tablosunda en az 1 rol olmalı.",
                    400,
                )

            # Duplicate kontrol (firma bazlı)
            exists = db.execute_query(
                "SELECT COUNT(*) AS Sayi FROM Kullanicilar WHERE FirmaId = ? AND KullaniciAdi = ?",
                (int(firma_id), kullanici_adi),
            )
            if exists and exists[0].get("Sayi", 0) > 0:
                return error_response("DUPLICATE_USERNAME", "Bu kullanıcı adı zaten kullanılıyor", 409)

            sifre_hash = hash_password(str(sifre))

            conn = db.get_connection()
            cursor = conn.cursor()
            insert_sql = """
                INSERT INTO Kullanicilar (FirmaId, KullaniciAdi, SifreHash, AdSoyad, Email, Aktif, OlusturmaTarihi)
                OUTPUT INSERTED.Id
                VALUES (?, ?, ?, ?, ?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()))
            """
            cursor.execute(
                insert_sql,
                (int(firma_id), kullanici_adi, sifre_hash, ad_soyad, email, 1 if bool(aktif) else 0),
            )
            row = cursor.fetchone()
            conn.commit()
            cursor.close()

            new_id = int(row[0]) if row else None
            # rol mapping
            for rid in role_ids:
                db.execute_query(
                    "INSERT INTO KullaniciRolleri (KullaniciId, RolId, OlusturmaTarihi) VALUES (?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()))",
                    (new_id, int(rid)),
                    fetch=False,
                )
            created = db.execute_query(
                """
                SELECT k.Id, k.FirmaId, k.KullaniciAdi, k.AdSoyad, k.Email, k.Aktif, k.OlusturmaTarihi
                FROM Kullanicilar k
                WHERE k.Id = ? AND k.FirmaId = ?
                """,
                (new_id, int(firma_id)),
            )

            return success_response(
                {
                    "firma": {
                        "id": firma[0]["Id"],
                        "kod": firma[0].get("Kod"),
                        "ad": firma[0].get("Ad"),
                        "aktif": bool(firma[0].get("Aktif")),
                    },
                    "kullanici": (created[0] if created else None),
                    "roller": [
                        r["RolAdi"]
                        for r in db.execute_query(
                            """
                            SELECT r.Ad as RolAdi
                            FROM KullaniciRolleri kr
                            INNER JOIN Roller r ON kr.RolId = r.Id
                            WHERE kr.KullaniciId = ?
                            ORDER BY r.Ad ASC
                            """,
                            (new_id,),
                        )
                    ],
                },
                message="Firma admin kullanıcısı oluşturuldu",
                status_code=201,
            )
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)


@companies_ns.route("/<int:firma_id>/status")
class CompanyStatus(Resource):
    @jwt_required()
    @require_super_admin
    @companies_ns.expect(company_status_model, validate=True)
    @companies_ns.doc(description="Firma aktif/pasif yapar (sadece süper admin)", security="Bearer")
    def put(self, firma_id: int):
        body = request.get_json() or {}
        aktif = body.get("aktif")
        if aktif is None:
            return error_response("VALIDATION_ERROR", "aktif alanı zorunludur", 400)

        try:
            # Firma var mı?
            firma = db.execute_query(
                "SELECT TOP 1 Id, Kod, Ad, Aciklama, Aktif, OlusturmaTarihi FROM Firmalar WHERE Id = ?",
                (int(firma_id),),
            )
            if not firma:
                return error_response("COMPANY_NOT_FOUND", "Firma bulunamadı", 404)

            db.execute_query(
                # Şema farklılıklarına takılmamak için sadece Aktif alanını güncelliyoruz.
                # (Bazı kurulumlarda Firmalar tablosunda GuncellemeTarihi kolonu olmayabilir.)
                "UPDATE Firmalar SET Aktif = ? WHERE Id = ?",
                (1 if bool(aktif) else 0, int(firma_id)),
                fetch=False,
            )

            updated = db.execute_query(
                "SELECT TOP 1 Id, Kod, Ad, Aciklama, Aktif, OlusturmaTarihi FROM Firmalar WHERE Id = ?",
                (int(firma_id),),
            )
            row = updated[0] if updated else firma[0]
            data = {
                "id": row["Id"],
                "kod": row["Kod"],
                "ad": row["Ad"],
                "aciklama": row.get("Aciklama"),
                "aktif": bool(row.get("Aktif")),
                "olusturma_tarihi": row.get("OlusturmaTarihi"),
            }
            return success_response(data, message="Firma durumu güncellendi", status_code=200)
        except Exception as exc:
            return error_response("INTERNAL_SERVER_ERROR", str(exc), 500)



