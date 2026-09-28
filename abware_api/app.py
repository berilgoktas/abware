"""
ABWare Backend Application
"""
from flask import Flask, request, render_template, redirect
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_restx import Api
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from config import config
import os
import logging
from utils.responses import error_response
from werkzeug.middleware.proxy_fix import ProxyFix

# Flask uygulamasını oluştur
def create_app(config_name=None):
    """Application factory pattern"""
    
    app = Flask(__name__)

    # Logging (DB debug satırları INFO seviyesinde basılır)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    
    # Config yükle
    config_name = config_name or os.getenv('FLASK_ENV', 'development')
    cfg_cls = config[config_name]
    app.config.from_object(cfg_cls)
    # CORS origins'i env'den tekrar parse et (boşluk/format hatalarına dayanıklı)
    app.config["CORS_ORIGINS"] = cfg_cls.parse_cors_origins(
        os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173")
    )
    # Reverse proxy / Cloudflare Tunnel arkasında doğru şema/host algısı için
    # (Swagger UI "Failed to fetch" hatası genelde http/https uyuşmazlığından çıkar.)
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1)
    app.config["PREFERRED_URL_SCHEME"] = os.getenv("PREFERRED_URL_SCHEME", "https")
    
    # CORS ayarla
    # Flask-CORS bazı durumlarda (flask-restx + jwt + OPTIONS) beklenmedik şekilde preflight'ı 401/redirect'e düşürebiliyor.
    # Bu yüzden hem Flask-CORS'u kullanıyoruz hem de preflight/headers için güvenli fallback ekliyoruz.
    CORS(
        app,
        resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
        supports_credentials=True,
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
        expose_headers=["Content-Type", "Authorization"],
        vary_header=True,
    )

    def _apply_cors_headers(resp):
        origin = request.headers.get("Origin")
        if not origin:
            return resp
        allowed = set(app.config.get("CORS_ORIGINS") or [])
        if origin in allowed:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Vary"] = "Origin"
            resp.headers["Access-Control-Allow-Credentials"] = "true"
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            req_headers = request.headers.get(
                "Access-Control-Request-Headers",
                "Authorization, Content-Type",
            )
            resp.headers["Access-Control-Allow-Headers"] = req_headers
        return resp

    @app.before_request
    def _cors_preflight():
        # Preflight OPTIONS isteği: auth ve rate limit'e takılmadan 200 dön (CORS header ile)
        if request.method == "OPTIONS" and (request.path or "").startswith("/api/"):
            resp = app.make_response(("", 200))
            return _apply_cors_headers(resp)
        return None

    @app.after_request
    def _cors_after(resp):
        return _apply_cors_headers(resp)

    # Swagger UI'a her girişte login zorunlu olsun:
    # - /api/docs (ve swagger UI asset path'leri) isteklerinde kısa süreli bir cookie yoksa /swagger-login'e yönlendir.
    # - Login sayfası, başarılı login sonrası bu cookie'yi kısa süreli set eder ve /api/docs'a geçirir.
    @app.before_request
    def _swagger_login_gate():
        p = request.path or ""
        is_swagger_docs = p.startswith("/api/docs") or p.startswith("/swaggerui") or p.startswith("/api/swaggerui")
        if not is_swagger_docs:
            return None
        if p.startswith("/api/docs/oauth2-redirect"):
            return None
        if request.cookies.get("swagger_login_ok") == "1":
            return None
        return redirect("/swagger-login")
    
    # Rate Limiting
    # IP adresini almak için X-Forwarded-For header'ını kontrol et (proxy arkasında çalışır)
    def _get_remote_address():
        """Proxy arkasında doğru IP adresini almak için"""
        if request.headers.getlist("X-Forwarded-For"):
            # X-Forwarded-For: client, proxy1, proxy2 formatında olabilir
            return request.headers.getlist("X-Forwarded-For")[0].split(',')[0].strip()
        return get_remote_address()
    
    limiter = Limiter(
        app=app,
        key_func=_get_remote_address,
        default_limits=[app.config.get('RATELIMIT_DEFAULT', '100 per minute')] if app.config.get('RATELIMIT_ENABLED', True) else [],
        storage_uri=app.config.get('RATELIMIT_STORAGE_URL', 'memory://'),
        strategy=app.config.get('RATELIMIT_STRATEGY', 'fixed-window'),
        headers_enabled=True,
    )
    
    # Rate limit error handler
    @app.errorhandler(429)
    def _rate_limit_handler(e):
        """Rate limit aşıldığında standart error response formatı döndür"""
        return error_response(
            "RATE_LIMIT_EXCEEDED",
            "Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin.",
            status_code=429
        ), 429
    
    # Rate limit'ten muaf tutulacak path'ler
    # OPTIONS (CORS preflight) istekleri zaten _cors_preflight'te handle ediliyor
    # Swagger UI asset path'leri ve swagger-login sayfası muaf tutuluyor
    @limiter.exempt
    @app.route('/swagger-login')
    def swagger_login_page():
        """Swagger UI login sayfası - rate limit'ten muaf"""
        return render_template('swagger_login.html')
    
    # JWT Manager
    jwt = JWTManager(app)

    # JWT hata handler'ları (flask-jwt-extended varsayılanı bazı durumlarda 422 döner;
    # API'de bunu standart 401 formatına çekiyoruz)
    @jwt.unauthorized_loader
    def _jwt_unauthorized(reason: str):
        # Authorization header eksik/hatalı
        return error_response("UNAUTHORIZED", "Kimlik doğrulama gerekli", status_code=401)

    @jwt.invalid_token_loader
    def _jwt_invalid(reason: str):
        # Örn: "Not enough segments" (token eksik/bozuk)
        msg = "Geçersiz token"
        if reason:
            msg = f"{msg}: {reason}"
        return error_response("UNAUTHORIZED", msg, status_code=401)

    @jwt.expired_token_loader
    def _jwt_expired(jwt_header, jwt_payload):
        return error_response("UNAUTHORIZED", "Token süresi dolmuş", status_code=401)

    @jwt.needs_fresh_token_loader
    def _jwt_needs_fresh(jwt_header, jwt_payload):
        return error_response("UNAUTHORIZED", "Token fresh değil", status_code=401)

    @jwt.revoked_token_loader
    def _jwt_revoked(jwt_header, jwt_payload):
        return error_response("UNAUTHORIZED", "Token iptal edilmiş", status_code=401)
    
    # API ve Swagger
    if app.config['SWAGGER_ENABLED']:
        api_description = (
            "ABWare Depo Yönetim Sistemi API Dokümantasyonu\n\n"
            "Kullanım Özeti:\n"
            "1. /auth/login endpoint'i ile giriş yapın (örnek: admin / admin123).\n"
            "2. Response içindeki \"data.token\" alanını kopyalayın.\n"
            "3. Swagger'da sağ üstteki \"Authorize\" butonuna tıklayın.\n"
            "4. Açılan kutuya \"Bearer <token>\" formatında yapıştırın.\n"
            "5. Artık kilit ikonlu endpoint'leri (dashboard, products, vb.) çalıştırabilirsiniz.\n"
            "\n"
            "Türkçe endpoint alias'ları (İngilizce yollar da çalışır):\n"
            "- /auth  -> /kimlik\n"
            "- /dashboard -> /panel\n"
            "- /products -> /urunler\n"
            "- /transactions -> /stok\n"
            "- /users -> /kullanicilar\n"
            "- /companies -> /firmalar\n"
            "- /reports -> /raporlar\n"
        )

        api = Api(
            app,
            version='1.0',
            title='ABWare API',
            description=api_description,
            doc='/api/docs',
            prefix='/api',
            authorizations={
                'Bearer': {
                    'type': 'apiKey',
                    'in': 'header',
                    'name': 'Authorization',
                    'description': 'JWT access token. Authorize penceresine \"Bearer <token>\" formatında değer girin.'
                }
            },
            security='Bearer'
        )
        
        # Swagger UI'a custom script ekle (token otomatik authorize için)
        @app.route('/swagger-auth.js')
        def swagger_auth_script():
            """Swagger UI için token otomatik authorize script'i"""
            from flask import send_from_directory
            import os
            # Önce static klasöründen dene, yoksa templates'den
            static_path = os.path.join(app.root_path, 'static')
            if os.path.exists(os.path.join(static_path, 'swagger_auth.js')):
                return send_from_directory(static_path, 'swagger_auth.js', mimetype='application/javascript')
            else:
                templates_path = os.path.join(app.root_path, 'templates')
                return send_from_directory(templates_path, 'swagger_auth.js', mimetype='application/javascript')
        
        # Swagger UI sayfasına script tag'i ekle
        @app.after_request
        def _inject_swagger_auth_script(response):
            """Swagger UI sayfasına swagger_auth.js script'ini ekle"""
            if request.path == '/api/docs' and response.status_code == 200:
                # Swagger UI HTML'ine script tag'i ekle
                if response.content_type and 'text/html' in response.content_type:
                    try:
                        html = response.get_data(as_text=True)
                        # </body> tag'inden önce script tag'i ekle
                        script_tag = '<script src="/swagger-auth.js"></script></body>'
                        if '</body>' in html and 'swagger-auth.js' not in html:
                            html = html.replace('</body>', script_tag)
                            response.set_data(html)
                    except Exception:
                        pass  # Hata durumunda sessizce devam et
            return response
    else:
        api = Api(
            app,
            version='1.0',
            title='ABWare API',
            prefix='/api'
        )
    
    # Blueprint'leri kaydet
    from routes.auth import auth_ns
    from routes.dashboard import dashboard_ns
    from routes.products import products_ns
    from routes.transactions import transactions_ns
    from routes.users import users_ns
    from routes.companies import companies_ns
    from routes.raflar import raflar_ns
    from routes.reports import reports_ns
    
    api.add_namespace(auth_ns, path='/auth')
    api.add_namespace(dashboard_ns, path='/dashboard')
    api.add_namespace(products_ns, path='/products')
    api.add_namespace(transactions_ns, path='/transactions')
    api.add_namespace(users_ns, path='/users')
    api.add_namespace(companies_ns, path='/companies')
    api.add_namespace(raflar_ns, path='/raflar')
    api.add_namespace(reports_ns, path='/reports')

    # Türkçe alias base path'ler (geriye uyumluluk için İngilizce path'ler de korunur)
    # Not: Bu yaklaşım aynı namespace'i ikinci kez mount eder.
    api.add_namespace(auth_ns, path='/kimlik')
    api.add_namespace(dashboard_ns, path='/panel')
    api.add_namespace(products_ns, path='/urunler')
    api.add_namespace(transactions_ns, path='/stok')
    api.add_namespace(users_ns, path='/kullanicilar')
    api.add_namespace(companies_ns, path='/firmalar')
    api.add_namespace(reports_ns, path='/raporlar')
    
    # NOT: Swagger UI'a erişim backende değil, frontend tarafındaki
    # swagger_login.html sayfası üzerinden kontrol ediliyor.
    # /api/docs herkese açık; gerçek API endpoint'leri JWT ile korunuyor.
    #
    # Yani:
    # - Kullanıcı genelde önce /swagger-login'e gider, login olur,
    #   sonra /api/docs'a yönlendirilir.
    # - Doğrudan /api/docs'a giden bir kullanıcı sadece dokümanı görür,
    #   ama hiçbir korumalı endpoint'e token olmadan istek atamaz.
    
    return app


if __name__ == '__main__':
    app = create_app()
    host = os.getenv('FLASK_HOST', '0.0.0.0')
    port = int(os.getenv('FLASK_PORT', 5000))
    app.run(host=host, port=port, debug=app.config['DEBUG'])

