"""
Authentication routes
"""
from flask_restx import Namespace, Resource, fields
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    jwt_required,
    get_jwt_identity,
    get_jwt,
    decode_token,
)
from flask import request
from database import db
from utils.password import verify_password, hash_password
from utils.responses import success_response, error_response

auth_ns = Namespace('auth', description='Kimlik doğrulama işlemleri')

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


# Request/Response modelleri
login_model = auth_ns.model('Login', {
    'firma_kodu': fields.String(required=True, description='Firma kodu (ör: DENEME)'),
    'kullanici_adi': fields.String(required=True, description='Kullanıcı adı'),
    'sifre': fields.String(required=True, description='Şifre')
})

refresh_model = auth_ns.model('Refresh', {
    'refresh_token': fields.String(required=True, description='Refresh token')
})

user_response_model = auth_ns.model('User', {
    'id': fields.Integer(description='Kullanıcı ID'),
    'firma_id': fields.Integer(description='Firma ID'),
    'firma_kodu': fields.String(description='Firma kodu'),
    'firma_adi': fields.String(description='Firma adı'),
    'kullanici_adi': fields.String(description='Kullanıcı adı'),
    'ad_soyad': fields.String(description='Ad Soyad'),
    'email': fields.String(description='E-posta'),
    'aktif': fields.Boolean(description='Aktif durumu'),
    'is_super_admin': fields.Boolean(description='Sistem genel yöneticisi mi?'),
    'roller': fields.List(fields.String, description='Kullanıcının sahip olduğu roller'),
})

login_response_model = auth_ns.model('LoginResponse', {
    'token': fields.String(description='JWT Access Token'),
    'refresh_token': fields.String(description='JWT Refresh Token'),
    'token_type': fields.String(description='Token tipi'),
    'expires_in': fields.Integer(description='Token geçerlilik süresi (saniye)'),
    'kullanici': fields.Nested(user_response_model)
})


@auth_ns.route('/login')
class Login(Resource):
    @auth_ns.expect(login_model)
    @auth_ns.doc(description='Kullanıcı girişi yapar ve JWT token döner')
    def post(self):
        """Kullanıcı girişi"""
        data = request.get_json()
        
        firma_kodu = (data.get('firma_kodu') or '').strip()
        kullanici_adi = data.get('kullanici_adi')
        sifre = data.get('sifre')
        
        if not firma_kodu or not kullanici_adi or not sifre:
            return error_response('VALIDATION_ERROR', 'Firma kodu, kullanıcı adı ve şifre zorunludur', status_code=400)
        
        try:
            # Firma kontrolü (pasif firma için özel mesaj)
            firma_rows = db.execute_query(
                "SELECT TOP 1 Id, Kod, Ad, Aktif FROM Firmalar WHERE Kod = ?",
                (firma_kodu,),
            )
            if not firma_rows:
                # Firma kodu yoksa da kullanıcı adı/şifre hatalı gibi davran (bilgi sızdırmamak için)
                return error_response('INVALID_CREDENTIALS', 'Kullanıcı adı veya şifre hatalı', status_code=401)
            firma = firma_rows[0]
            if not bool(firma.get("Aktif", 0)):
                return error_response(
                    "COMPANY_INACTIVE",
                    "Firmanız pasife alınmıştır",
                    status_code=403,
                )

            # Kullanıcıyı ve bağlı olduğu firmayı veritabanından bul
            query = """
                SELECT 
                    k.Id,
                    k.FirmaId,
                    k.KullaniciAdi,
                    k.SifreHash,
                    k.AdSoyad,
                    k.Email,
                    k.Aktif,
                    k.IsSuperAdmin,
                    f.Kod as FirmaKod,
                    f.Ad as FirmaAd,
                    f.Aktif as FirmaAktif
                FROM Kullanicilar k
                INNER JOIN Firmalar f ON k.FirmaId = f.Id
                WHERE f.Kod = ? AND k.KullaniciAdi = ? AND k.Aktif = 1 AND f.Aktif = 1
            """
            result = db.execute_query(query, (firma_kodu, kullanici_adi))
            
            if not result:
                return error_response('INVALID_CREDENTIALS', 'Kullanıcı adı veya şifre hatalı', status_code=401)
            
            user = result[0]
            roles = _get_user_roles(int(user["Id"]))
            
            # Şifreyi doğrula
            if not verify_password(sifre, user['SifreHash']):
                return error_response('INVALID_CREDENTIALS', 'Kullanıcı adı veya şifre hatalı', status_code=401)
            
            # JWT token oluştur
            additional_claims = {
                'roller': roles,
                'firma_id': user['FirmaId'],
                'firma_kodu': user['FirmaKod'],
                'is_super_admin': bool(user['IsSuperAdmin'])
            }
            
            # Flask-JWT-Extended >=4.6 için identity (sub) string olmalı
            identity = str(user['Id'])
            access_token = create_access_token(
                identity=identity,
                additional_claims=additional_claims,
            )
            refresh_token = create_refresh_token(identity=identity)
            
            # Son giriş tarihini güncelle
            update_query = "UPDATE Kullanicilar SET SonGirisTarihi = DATEADD(HOUR, 3, SYSUTCDATETIME()) WHERE Id = ?"
            db.execute_query(update_query, (user['Id'],), fetch=False)
            
            # Response hazırla
            user_data = {
                'id': user['Id'],
                'firma_id': user['FirmaId'],
                'firma_kodu': user['FirmaKod'],
                'firma_adi': user['FirmaAd'],
                'kullanici_adi': user['KullaniciAdi'],
                'ad_soyad': user['AdSoyad'],
                'email': user['Email'],
                'aktif': bool(user['Aktif']),
                'is_super_admin': bool(user['IsSuperAdmin']),
                'roller': roles,
            }
            
            response_data = {
                'firma_id': user['FirmaId'],
                'kullanici_adi': user['KullaniciAdi'],
                'token': access_token,
                'refresh_token': refresh_token,
                'token_type': 'Bearer',
                'expires_in': 86400,  # 24 saat
                'kullanici': user_data
            }
            
            return success_response(response_data, 'Giriş başarılı', 200)
            
        except Exception as e:
            return error_response('INTERNAL_SERVER_ERROR', str(e), status_code=500)


@auth_ns.route('/logout')
class Logout(Resource):
    @jwt_required()
    @auth_ns.doc(description='Kullanıcı çıkışı yapar', security='Bearer')
    def post(self):
        """Kullanıcı çıkışı"""
        # JWT token'lar stateless olduğu için burada sadece başarı mesajı döner
        # İsterseniz token'ı blacklist'e ekleyebilirsiniz
        return success_response(message='Çıkış başarılı', status_code=200)


@auth_ns.route('/refresh')
class Refresh(Resource):
    @auth_ns.expect(refresh_model)
    @auth_ns.doc(description='JWT token yeniler')
    @jwt_required(refresh=True)
    def post(self):
        """Token yenile"""
        try:
            user_id = get_jwt_identity()
            # jwt_required(refresh=True) ile geldiğimizde user_id refresh token'dan gelir.
            
            # Kullanıcıyı ve firmasını kontrol et
            query = """
                SELECT 
                    k.Id,
                    k.FirmaId,
                    k.Aktif,
                    k.IsSuperAdmin,
                    f.Kod as FirmaKod,
                    f.Ad as FirmaAd,
                    f.Aktif as FirmaAktif
                FROM Kullanicilar k
                INNER JOIN Firmalar f ON k.FirmaId = f.Id
                WHERE k.Id = ? AND k.Aktif = 1 AND f.Aktif = 1
            """
            result = db.execute_query(query, (user_id,))
            
            if not result:
                # Firma pasife alındıysa yenilemeye özel mesaj verelim
                inactive_check = db.execute_query(
                    """
                    SELECT TOP 1 f.Aktif as FirmaAktif
                    FROM Kullanicilar k
                    INNER JOIN Firmalar f ON k.FirmaId = f.Id
                    WHERE k.Id = ?
                    """,
                    (user_id,),
                )
                if inactive_check and not bool(inactive_check[0].get("FirmaAktif", 0)):
                    return error_response("COMPANY_INACTIVE", "Firmanız pasife alınmıştır", status_code=403)
                return error_response('USER_NOT_FOUND', 'Kullanıcı bulunamadı', status_code=404)
            
            user = result[0]
            roles = _get_user_roles(int(user["Id"]))
            
            # Yeni token oluştur
            additional_claims = {
                'roller': roles,
                'firma_id': user['FirmaId'],
                'firma_kodu': user['FirmaKod'],
                'is_super_admin': bool(user['IsSuperAdmin'])
            }
            
            access_token = create_access_token(
                identity=user_id,
                additional_claims=additional_claims
            )
            refresh_token = create_refresh_token(identity=user_id)
            
            response_data = {
                'token': access_token,
                'refresh_token': refresh_token,
                'token_type': 'Bearer',
                'expires_in': 86400
            }
            
            return success_response(response_data, status_code=200)
            
        except Exception as e:
            return error_response('INTERNAL_SERVER_ERROR', str(e), status_code=500)


@auth_ns.route('/refresh-body')
class RefreshFromBody(Resource):
    @auth_ns.expect(refresh_model)
    @auth_ns.doc(description='Refresh token (body) ile yeni access token üretir')
    def post(self):
        """
        Uyumluluk endpoint'i:
        Bazı istemciler refresh token'ı Authorization header yerine body'de gönderiyor.
        """
        try:
            data = request.get_json() or {}
            token = data.get("refresh_token")
            if not token:
                return error_response("VALIDATION_ERROR", "refresh_token zorunludur", status_code=400)

            decoded = decode_token(token)
            if (decoded or {}).get("type") != "refresh":
                return error_response("VALIDATION_ERROR", "refresh_token geçersiz (type)", status_code=400)

            user_id = decoded.get("sub")
            if user_id is None:
                return error_response("UNAUTHORIZED", "Geçersiz kullanıcı", status_code=401)

            # Kullanıcıyı ve firmasını kontrol et (aktif firma)
            query = """
                SELECT 
                    k.Id,
                    k.FirmaId,
                    k.Aktif,
                    k.IsSuperAdmin,
                    f.Kod as FirmaKod,
                    f.Ad as FirmaAd,
                    f.Aktif as FirmaAktif
                FROM Kullanicilar k
                INNER JOIN Firmalar f ON k.FirmaId = f.Id
                WHERE k.Id = ? AND k.Aktif = 1 AND f.Aktif = 1
            """
            result = db.execute_query(query, (user_id,))
            if not result:
                # Firma pasif olabilir
                inactive_check = db.execute_query(
                    """
                    SELECT TOP 1 f.Aktif as FirmaAktif
                    FROM Kullanicilar k
                    INNER JOIN Firmalar f ON k.FirmaId = f.Id
                    WHERE k.Id = ?
                    """,
                    (user_id,),
                )
                if inactive_check and not bool(inactive_check[0].get("FirmaAktif", 0)):
                    return error_response("COMPANY_INACTIVE", "Firmanız pasife alınmıştır", status_code=403)
                return error_response("USER_NOT_FOUND", "Kullanıcı bulunamadı", status_code=404)

            user = result[0]
            roles = _get_user_roles(int(user["Id"]))

            additional_claims = {
                "roller": roles,
                "firma_id": user["FirmaId"],
                "firma_kodu": user["FirmaKod"],
                "is_super_admin": bool(user["IsSuperAdmin"]),
            }
            access_token = create_access_token(identity=str(user["Id"]), additional_claims=additional_claims)
            refresh_token = create_refresh_token(identity=str(user["Id"]))
            return success_response(
                {
                    "token": access_token,
                    "refresh_token": refresh_token,
                    "token_type": "Bearer",
                    "expires_in": 86400,
                },
                status_code=200,
            )
        except Exception as e:
            return error_response("INTERNAL_SERVER_ERROR", str(e), status_code=500)


@auth_ns.route('/me')
class Me(Resource):
    @jwt_required()
    @auth_ns.doc(
        description='Mevcut kullanıcı bilgilerini döner (güncel rollerle birlikte)',
        security='Bearer'
    )
    def get(self):
        """Mevcut kullanıcı bilgilerini döndürür (veritabanından güncel rollerle)"""
        try:
            from middleware.auth import get_current_user
            user = get_current_user()
            if not user:
                return error_response("UNAUTHORIZED", "Kullanıcı bulunamadı veya pasif", status_code=401)
            return success_response({"kullanici": user}, status_code=200)
        except Exception as e:
            return error_response("INTERNAL_SERVER_ERROR", str(e), status_code=500)


