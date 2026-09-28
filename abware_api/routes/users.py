"""
Users routes
"""
from flask import request
from flask_restx import Namespace, Resource, fields
from flask_jwt_extended import jwt_required

from database import db
from utils.password import hash_password
from utils.responses import success_response, error_response
from middleware.auth import require_role, get_current_firma_id
from utils.pagination import parse_limit

users_ns = Namespace('users', description='Kullanıcı yönetimi işlemleri')

@users_ns.route('/roles')
class Roles(Resource):
    @jwt_required()
    @users_ns.doc(description="Rolleri listeler", security="Bearer")
    def get(self):
        """Roller tablosundaki tüm rolleri döndürür."""
        try:
            roles = db.execute_query("SELECT Id, Ad, Aciklama FROM Roller ORDER BY Ad ASC")
            mapped = [
                {"id": r["Id"], "ad": r["Ad"], "aciklama": r.get("Aciklama")}
                for r in (roles or [])
            ]
            return success_response({"roller": mapped}, status_code=200)
        except Exception as e:
            return error_response("INTERNAL_SERVER_ERROR", str(e), status_code=500)


def _get_roles() -> list[dict]:
    return db.execute_query("SELECT Id, Ad FROM Roller ORDER BY Ad ASC")


def _get_user_roles(user_id: int) -> list[str]:
    rows = db.execute_query(
        """
        SELECT r.Ad AS RolAdi
        FROM KullaniciRolleri kr
        INNER JOIN Roller r ON kr.RolId = r.Id
        WHERE kr.KullaniciId = ?
        ORDER BY r.Ad ASC
        """,
        (int(user_id),),
    )
    return [str(r.get("RolAdi") or "").strip() for r in (rows or []) if (r.get("RolAdi") or "").strip()]


def _get_roles_for_users(user_ids: list[int]) -> dict[int, list[str]]:
    """
    Kullanıcı listesi için N+1 rol sorgusunu önlemek adına toplu rol çekimi.
    Dönüş: {KullaniciId: [RolAdi, ...]}
    """
    if not user_ids:
        return {}
    placeholders = ",".join(["?"] * len(user_ids))
    rows = db.execute_query(
        f"""
        SELECT kr.KullaniciId, r.Ad AS RolAdi
        FROM KullaniciRolleri kr
        INNER JOIN Roller r ON kr.RolId = r.Id
        WHERE kr.KullaniciId IN ({placeholders})
        ORDER BY kr.KullaniciId ASC, r.Ad ASC
        """,
        tuple(int(x) for x in user_ids),
    )
    out: dict[int, list[str]] = {}
    for row in (rows or []):
        uid = int(row.get("KullaniciId"))
        rol = str(row.get("RolAdi") or "").strip()
        if not rol:
            continue
        out.setdefault(uid, []).append(rol)
    return out


def _set_user_roles(user_id: int, role_ids: list[int]) -> None:
    # mevcutları temizle -> yeniden yaz (basit ve deterministik)
    db.execute_query("DELETE FROM KullaniciRolleri WHERE KullaniciId = ?", (int(user_id),), fetch=False)
    if not role_ids:
        return
    # doğrula ve insert et
    valid = db.execute_query(
        f"SELECT Id FROM Roller WHERE Id IN ({','.join(['?']*len(role_ids))})",
        tuple(int(x) for x in role_ids),
    )
    valid_ids = {int(r["Id"]) for r in (valid or [])}
    missing = [int(x) for x in role_ids if int(x) not in valid_ids]
    if missing:
        raise ValueError(f"Geçersiz rol_id: {missing}")
    for rid in sorted(valid_ids):
        db.execute_query(
            "INSERT INTO KullaniciRolleri (KullaniciId, RolId, OlusturmaTarihi) VALUES (?, ?, DATEADD(HOUR, 3, SYSUTCDATETIME()))",
            (int(user_id), int(rid)),
            fetch=False,
        )


user_create_model = users_ns.model(
    "UserCreate",
    {
        "kullanici_adi": fields.String(required=True, description="Kullanıcı adı"),
        "sifre": fields.String(required=True, description="Şifre (min 6 karakter)"),
        "ad_soyad": fields.String(required=True, description="Ad Soyad"),
        "email": fields.String(required=False, description="E-posta"),
        "rol_ids": fields.List(fields.Integer, required=False, description="Rol ID listesi (Roller tablosundan)"),
        "aktif": fields.Boolean(required=False, description="Aktif mi? (default: true)", default=True),
    },
)

user_update_model = users_ns.model(
    "UserUpdate",
    {
        "kullanici_adi": fields.String(required=False, description="Kullanıcı adı"),
        "sifre": fields.String(required=False, description="Yeni şifre (min 6 karakter)"),
        "ad_soyad": fields.String(required=False, description="Ad Soyad"),
        "email": fields.String(required=False, description="E-posta"),
        "rol_ids": fields.List(fields.Integer, required=False, description="Rol ID listesi (Roller tablosundan)"),
        "aktif": fields.Boolean(required=False, description="Aktif mi?"),
    },
)

user_status_model = users_ns.model(
    "UserStatus",
    {
        "aktif": fields.Boolean(required=True, description="Aktif mi?"),
    },
)


@users_ns.route('')
class Users(Resource):
    @jwt_required()
    @require_role('Kullanıcı Yönetimi')
    @users_ns.doc(
        description='Kullanıcı listesi',
        security='Bearer',
        params={
            "limit": {"description": "Kaç kayıt gelsin? (default 100, max 5000)", "type": "integer", "default": 100},
        },
    )
    def get(self):
        """Aktif firmanın kullanıcı listesini döndürür."""
        try:
            firma_id = get_current_firma_id()
            if not firma_id:
                return error_response('UNAUTHORIZED', 'Geçersiz firma bilgisi', status_code=401)

            limit = parse_limit(request.args, default_limit=100, max_limit=5000)

            query = """
                SELECT 
                    k.Id,
                    k.KullaniciAdi,
                    k.AdSoyad,
                    k.Email,
                    k.Aktif,
                    k.OlusturmaTarihi
                FROM Kullanicilar k
                WHERE k.FirmaId = ?
                ORDER BY k.OlusturmaTarihi DESC
            """
            query = "SELECT TOP (?) k.Id, k.KullaniciAdi, k.AdSoyad, k.Email, k.Aktif, k.OlusturmaTarihi FROM Kullanicilar k WHERE k.FirmaId = ? ORDER BY k.OlusturmaTarihi DESC"
            kullanicilar = db.execute_query(query, (limit, firma_id))
            # rolleri toplu çek (N+1'den kaçın)
            ids = [int(k["Id"]) for k in (kullanicilar or []) if k.get("Id") is not None]
            roles_map = _get_roles_for_users(ids)
            for k in (kullanicilar or []):
                k["Roller"] = roles_map.get(int(k["Id"]), [])

            data = {'kullanicilar': kullanicilar, 'sayfalama': {"limit": limit, "donen": len(kullanicilar)}}
            return success_response(data, status_code=200)
        except Exception as e:
            return error_response('INTERNAL_SERVER_ERROR', str(e), status_code=500)


    @jwt_required()
    @require_role('Kullanıcı Yönetimi')
    @users_ns.expect(user_create_model, validate=True)
    @users_ns.doc(description='Yeni kullanıcı ekler (Admin)', security='Bearer')
    def post(self):
        """Aktif firmaya yeni kullanıcı ekler."""
        body = request.get_json() or {}
        kullanici_adi = (body.get("kullanici_adi") or "").strip()
        sifre = body.get("sifre")
        ad_soyad = (body.get("ad_soyad") or "").strip()
        email = (body.get("email") or "").strip() or None
        rol_ids = body.get("rol_ids") or []
        aktif = body.get("aktif", True)

        if not kullanici_adi or not sifre or not ad_soyad:
            return error_response("VALIDATION_ERROR", "kullanici_adi, sifre ve ad_soyad zorunludur", 400)
        if len(str(sifre)) < 6:
            return error_response("VALIDATION_ERROR", "Şifre en az 6 karakter olmalıdır", 400)

        firma_id = get_current_firma_id()
        if not firma_id:
            return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", status_code=401)

        try:
            # Duplicate kontrol (firma bazlı)
            exists = db.execute_query(
                "SELECT COUNT(*) AS Sayi FROM Kullanicilar WHERE FirmaId = ? AND KullaniciAdi = ?",
                (firma_id, kullanici_adi),
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
                (firma_id, kullanici_adi, sifre_hash, ad_soyad, email, 1 if bool(aktif) else 0),
            )
            row = cursor.fetchone()
            conn.commit()
            cursor.close()

            new_id = int(row[0]) if row else None
            # rol set et
            try:
                _set_user_roles(new_id, [int(x) for x in rol_ids])
            except ValueError as ve:
                return error_response("VALIDATION_ERROR", str(ve), 400)
            created = db.execute_query(
                """
                SELECT k.Id, k.KullaniciAdi, k.AdSoyad, k.Email, k.Aktif, k.OlusturmaTarihi
                FROM Kullanicilar k
                WHERE k.Id = ? AND k.FirmaId = ?
                """,
                (new_id, firma_id),
            )
            user_row = created[0] if created else None
            if user_row:
                user_row["Roller"] = _get_user_roles(new_id)
            return success_response({"kullanici": user_row}, "Kullanıcı başarıyla eklendi", 201)
        except Exception as e:
            return error_response("INTERNAL_SERVER_ERROR", str(e), status_code=500)


@users_ns.route('/<int:id>')
class User(Resource):
    @jwt_required()
    @require_role('Kullanıcı Yönetimi')
    @users_ns.expect(user_update_model, validate=False)
    @users_ns.doc(description='Kullanıcı günceller (Admin)', security='Bearer')
    def put(self, id: int):
        """Kullanıcı bilgilerini günceller (firma bazlı)."""
        body = request.get_json() or {}
        kullanici_adi = body.get("kullanici_adi")
        sifre = body.get("sifre")
        ad_soyad = body.get("ad_soyad")
        email = body.get("email")
        rol_ids = body.get("rol_ids")
        aktif = body.get("aktif")

        if all(v is None for v in [kullanici_adi, sifre, ad_soyad, email, rol_ids, aktif]):
            return error_response("VALIDATION_ERROR", "Güncellenecek en az bir alan gönderilmelidir", 400)

        firma_id = get_current_firma_id()
        if not firma_id:
            return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", status_code=401)

        try:
            mevcut = db.execute_query(
                "SELECT TOP 1 * FROM Kullanicilar WHERE Id = ? AND FirmaId = ?",
                (id, firma_id),
            )
            if not mevcut:
                return error_response("USER_NOT_FOUND", "Kullanıcı bulunamadı", 404)

            set_parts = []
            params = []

            if kullanici_adi is not None:
                s = str(kullanici_adi).strip()
                if not s:
                    return error_response("VALIDATION_ERROR", "kullanici_adi boş olamaz", 400)
                # aynı firmada duplicate kontrol (kendisi hariç)
                exists = db.execute_query(
                    "SELECT COUNT(*) AS Sayi FROM Kullanicilar WHERE FirmaId = ? AND KullaniciAdi = ? AND Id <> ?",
                    (firma_id, s, id),
                )
                if exists and exists[0].get("Sayi", 0) > 0:
                    return error_response("DUPLICATE_USERNAME", "Bu kullanıcı adı zaten kullanılıyor", 409)
                set_parts.append("KullaniciAdi = ?")
                params.append(s)

            if ad_soyad is not None:
                s = str(ad_soyad).strip()
                if not s:
                    return error_response("VALIDATION_ERROR", "ad_soyad boş olamaz", 400)
                set_parts.append("AdSoyad = ?")
                params.append(s)

            if email is not None:
                set_parts.append("Email = ?")
                params.append((str(email).strip() or None))

            # roller ayrı tabloda tutuluyor
            if rol_ids is not None:
                # "Kullanıcı Yönetimi" rolünün ID'sini bul
                kullanici_yonetimi_rol = db.execute_query(
                    "SELECT Id FROM Roller WHERE Ad = N'Kullanıcı Yönetimi'"
                )
                if not kullanici_yonetimi_rol:
                    return error_response("INTERNAL_SERVER_ERROR", "Kullanıcı Yönetimi rolü bulunamadı", 500)
                kullanici_yonetimi_rol_id = int(kullanici_yonetimi_rol[0]["Id"])
                
                # Mevcut kullanıcının rollerini kontrol et
                mevcut_roller = db.execute_query(
                    "SELECT RolId FROM KullaniciRolleri WHERE KullaniciId = ?",
                    (id,)
                )
                mevcut_rol_ids = {int(r["RolId"]) for r in (mevcut_roller or [])}
                mevcut_kullanici_yonetimi_var = kullanici_yonetimi_rol_id in mevcut_rol_ids
                
                # Yeni rol listesi
                yeni_rol_ids = [int(x) for x in (rol_ids or [])]
                yeni_kullanici_yonetimi_var = kullanici_yonetimi_rol_id in yeni_rol_ids
                
                # Eğer "Kullanıcı Yönetimi" rolü kaldırılıyorsa kontrol et
                if mevcut_kullanici_yonetimi_var and not yeni_kullanici_yonetimi_var:
                    # Bu firmada başka hiç kimse "Kullanıcı Yönetimi" rolüne sahip mi?
                    diger_kullanicilar = db.execute_query(
                        """
                        SELECT COUNT(*) AS Sayi
                        FROM KullaniciRolleri kr
                        INNER JOIN Kullanicilar k ON kr.KullaniciId = k.Id
                        WHERE k.FirmaId = ? 
                          AND kr.KullaniciId <> ?
                          AND kr.RolId = ?
                          AND k.Aktif = 1
                        """,
                        (firma_id, id, kullanici_yonetimi_rol_id)
                    )
                    diger_sayi = diger_kullanicilar[0].get("Sayi", 0) if diger_kullanicilar else 0
                    
                    if diger_sayi == 0:
                        return error_response(
                            "VALIDATION_ERROR",
                            "Her firmada en az bir kullanıcının 'Kullanıcı Yönetimi' rolüne sahip olması gerekir. Bu yetkiyi kaldıramazsınız.",
                            400
                        )
                
                try:
                    _set_user_roles(id, yeni_rol_ids)
                except ValueError as ve:
                    return error_response("VALIDATION_ERROR", str(ve), 400)

            if aktif is not None:
                set_parts.append("Aktif = ?")
                params.append(1 if bool(aktif) else 0)

            if sifre is not None:
                if len(str(sifre)) < 6:
                    return error_response("VALIDATION_ERROR", "Şifre en az 6 karakter olmalıdır", 400)
                set_parts.append("SifreHash = ?")
                params.append(hash_password(str(sifre)))

            set_parts.append("GuncellemeTarihi = DATEADD(HOUR, 3, SYSUTCDATETIME())")
            sql = "UPDATE Kullanicilar SET " + ", ".join(set_parts) + " WHERE Id = ? AND FirmaId = ?"
            params.append(id)
            params.append(firma_id)

            db.execute_query(sql, tuple(params), fetch=False)

            updated = db.execute_query(
                """
                SELECT k.Id, k.KullaniciAdi, k.AdSoyad, k.Email, k.Aktif, k.GuncellemeTarihi
                FROM Kullanicilar k
                WHERE k.Id = ? AND k.FirmaId = ?
                """,
                (id, firma_id),
            )
            user_row = updated[0] if updated else None
            if user_row:
                user_row["Roller"] = _get_user_roles(id)
            return success_response({"kullanici": user_row}, "Kullanıcı güncellendi", 200)
        except Exception as e:
            return error_response("INTERNAL_SERVER_ERROR", str(e), status_code=500)


@users_ns.route('/<int:id>/status')
class UserStatus(Resource):
    @jwt_required()
    @require_role('Kullanıcı Yönetimi')
    @users_ns.expect(user_status_model, validate=True)
    @users_ns.doc(description='Kullanıcı aktif/pasif durumunu günceller (Admin)', security='Bearer')
    def put(self, id: int):
        body = request.get_json() or {}
        aktif = body.get("aktif")
        if aktif is None:
            return error_response("VALIDATION_ERROR", "aktif alanı zorunludur", 400)

        firma_id = get_current_firma_id()
        if not firma_id:
            return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", status_code=401)

        try:
            mevcut = db.execute_query(
                "SELECT TOP 1 Id, Aktif FROM Kullanicilar WHERE Id = ? AND FirmaId = ?",
                (id, firma_id),
            )
            if not mevcut:
                return error_response("USER_NOT_FOUND", "Kullanıcı bulunamadı", 404)

            db.execute_query(
                "UPDATE Kullanicilar SET Aktif = ?, GuncellemeTarihi = DATEADD(HOUR, 3, SYSUTCDATETIME()) WHERE Id = ? AND FirmaId = ?",
                (1 if bool(aktif) else 0, id, firma_id),
                fetch=False,
            )
            yeni = db.execute_query(
                "SELECT TOP 1 Id, KullaniciAdi, Aktif FROM Kullanicilar WHERE Id = ? AND FirmaId = ?",
                (id, firma_id),
            )
            return success_response({"kullanici": yeni[0] if yeni else None}, "Kullanıcı durumu güncellendi", 200)
        except Exception as e:
            return error_response("INTERNAL_SERVER_ERROR", str(e), status_code=500)

