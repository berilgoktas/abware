"""
Authentication middleware
"""
from functools import wraps
from typing import Optional
import logging

from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity, get_jwt

from utils.responses import error_response
from database import db

logger = logging.getLogger(__name__)


def _normalize_role_name(value: str) -> str:
    return (value or "").strip().casefold()


def _get_user_roles(user_id: int) -> list[str]:
    """
    Kullanıcının sahip olduğu rol adlarını döndürür (KullaniciRolleri -> Roller).
    Roller artık firma-bazlı değil globaldir; kullanıcı firma-bazlı olduğundan yeterlidir.
    """
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


def get_current_firma_id() -> Optional[int]:
    """
    Mevcut firma_id'yi güvenli şekilde döndürür.

    Kural:
    - Firma bağlamı sadece JWT içindeki firma_id claim'inden alınır.
    """
    try:
        claims = get_jwt()
        raw = claims.get("firma_id") if claims else None
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def require_firma_context(f):
    """Token içindeki firma_id claim'inin varlığını kontrol eder."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        firma_id = get_current_firma_id()
        if not firma_id:
            return error_response(
                "UNAUTHORIZED",
                "Geçersiz firma bilgisi. Token içinde firma_id bulunamadı.",
                status_code=401,
            )
        return f(*args, **kwargs)
    return decorated_function


def require_auth(f):
    """JWT token gerektiren decorator"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            verify_jwt_in_request()
        except Exception as e:
            return error_response("UNAUTHORIZED", "Kimlik doğrulama gerekli", status_code=401)
        return f(*args, **kwargs)
    return decorated_function


def require_role(*allowed_roles):
    """Belirli rol(ler) gerektiren decorator"""
    def decorator(f):
        @wraps(f)
        @require_auth
        def decorated_function(*args, **kwargs):
            try:
                # Sistem süper admin ise tüm rolleri bypass et
                claims = get_jwt()
                if bool((claims or {}).get("is_super_admin")):
                    return f(*args, **kwargs)

                user_id = get_jwt_identity()
                firma_id = get_current_firma_id()
                # identity string geldiği için integer'a çevir
                try:
                    user_id_int = int(user_id)
                except (TypeError, ValueError):
                    return error_response("UNAUTHORIZED", "Geçersiz kullanıcı kimliği", status_code=401)
                if not firma_id:
                    return error_response("UNAUTHORIZED", "Geçersiz firma bilgisi", status_code=401)

                # Kullanıcının rollerini al
                roles = _get_user_roles(user_id_int)
                logger.debug(f"User {user_id_int} roles: {roles}, required: {allowed_roles}")
                
                if not roles:
                    return error_response(
                        "FORBIDDEN", 
                        f"Bu işlem için yetkiniz yok. Gerekli rol(ler): {', '.join(allowed_roles)}. Mevcut rolleriniz: (rol atanmamış)", 
                        status_code=403
                    )

                allowed_norm = {_normalize_role_name(r) for r in allowed_roles}
                user_norm = {_normalize_role_name(r) for r in roles}
                
                logger.debug(f"Normalized - required: {allowed_norm}, user: {user_norm}, intersection: {user_norm & allowed_norm}")

                if not (user_norm & allowed_norm):
                    return error_response(
                        "FORBIDDEN", 
                        f"Bu işlem için yetkiniz yok. Gerekli rol(ler): {', '.join(allowed_roles)}. Mevcut rolleriniz: {', '.join(roles) if roles else '(rol atanmamış)'}", 
                        status_code=403
                    )
                
                return f(*args, **kwargs)
            except Exception as e:
                return error_response("INTERNAL_SERVER_ERROR", str(e), status_code=500)
        return decorated_function
    return decorator


def require_super_admin(f):
    """
    Sistem genelinde yetkili kullanıcılar için decorator.

    Kabul kriteri:
    - Token claim'i `is_super_admin` True (eski davranış, sistem süper admin kullanıcıları)
    - veya token claim'i `rol_ad` == "SUPER_ADMIN" (Roller tablosundaki yeni rol)
    """
    @wraps(f)
    @require_auth
    def decorated_function(*args, **kwargs):
        try:
            claims = get_jwt()
            is_system_super_admin = bool((claims or {}).get("is_super_admin"))

            if not is_system_super_admin:
                return error_response("FORBIDDEN", "Bu işlem için süper admin yetkisi gereklidir", status_code=403)
            return f(*args, **kwargs)
        except Exception as e:
            return error_response("INTERNAL_SERVER_ERROR", str(e), status_code=500)
    return decorated_function


def get_current_user():
    """Mevcut kullanıcı bilgilerini döndür"""
    try:
        user_id = get_jwt_identity()
        firma_id = get_current_firma_id()
        try:
            user_id_int = int(user_id)
        except (TypeError, ValueError):
            import logging
            logging.warning(f"get_current_user: Invalid user_id from token: {user_id}")
            return None
        if not firma_id:
            import logging
            logging.warning(f"get_current_user: No firma_id in token for user_id: {user_id_int}")
            return None
        query = """
            SELECT 
                k.Id,
                k.FirmaId,
                k.KullaniciAdi,
                k.AdSoyad,
                k.Email,
                k.Aktif,
                k.OlusturmaTarihi,
                f.Kod as FirmaKod,
                f.Ad as FirmaAd
            FROM Kullanicilar k
            INNER JOIN Firmalar f ON k.FirmaId = f.Id
            WHERE k.Id = ? AND k.FirmaId = ? AND k.Aktif = 1 AND f.Aktif = 1
        """
        result = db.execute_query(query, (user_id_int, firma_id))
        
        if not result:
            import logging
            logging.warning(f"get_current_user: User not found or inactive: user_id={user_id_int}, firma_id={firma_id}")
            return None
        
        user = result[0]
        roles = _get_user_roles(user_id_int)
        
        # is_super_admin bilgisini de ekle
        is_super_admin = bool(user.get('IsSuperAdmin') if 'IsSuperAdmin' in user else False)
        # Token'dan is_super_admin claim'ini kontrol et
        try:
            claims = get_jwt()
            if claims and claims.get("is_super_admin"):
                is_super_admin = True
        except:
            pass
        
        return {
            "id": user['Id'],
            "firma_id": user['FirmaId'],
            "firma_kodu": user['FirmaKod'],
            "firma_adi": user['FirmaAd'],
            "kullanici_adi": user['KullaniciAdi'],
            "ad_soyad": user['AdSoyad'],
            "email": user['Email'],
            "aktif": user['Aktif'],
            "is_super_admin": is_super_admin,
            "olusturma_tarihi": user['OlusturmaTarihi'].isoformat() if user['OlusturmaTarihi'] and hasattr(user['OlusturmaTarihi'], 'isoformat') else (str(user['OlusturmaTarihi']) if user['OlusturmaTarihi'] else None),
            "roller": roles,
        }
    except Exception as e:
        import logging
        logging.error(f"get_current_user: Exception: {str(e)}", exc_info=True)
        return None

