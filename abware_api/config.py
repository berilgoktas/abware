"""
ABWare Backend Configuration
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# .env dosyasını yükle
# Not: load_dotenv() varsayılan olarak "mevcut çalışma dizinini" (cwd) baz alır.
# Uygulama farklı bir klasörden çalıştırılırsa (.exe/service/docker vs) .env bulunmayabilir.
# Bu yüzden config.py'nin bulunduğu klasöre sabitliyoruz.
_BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=_BASE_DIR / ".env", override=False)


class Config:
    """Base configuration"""

    @staticmethod
    def parse_cors_origins(value: str) -> list[str]:
        return [o.strip() for o in (value or "").split(",") if (o or "").strip()]
    
    # Flask Settings
    # Flask session/csrf gibi mekanizmalar için ayrı bir secret kullanmak daha sağlıklıdır.
    # JWT için JWT_SECRET_KEY kullanılır.
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-flask-secret-change-in-production')
    # Prod güvenliği: varsayılan False. DevelopmentConfig zaten True yapıyor.
    DEBUG = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    ENV = os.getenv('FLASK_ENV', 'development')
    
    # Database Settings
    # Not: SQL Server için ip,port formatı desteklenir (örn: 10.0.0.4,1433)
    DB_SERVER = os.getenv('DB_SERVER', '10.0.0.4,1433')
    DB_DATABASE = os.getenv('DB_DATABASE', 'ABWareDB_Test')  # Test veritabanı
    DB_USERNAME = os.getenv('DB_USERNAME', 'sa')
    DB_PASSWORD = os.getenv('DB_PASSWORD', '')
    # Not: Driver 18, TLS/Encrypt tarafında daha uyumlu (SSMS çoğunlukla 18/19 kullanır).
    DB_DRIVER = os.getenv('DB_DRIVER', 'ODBC Driver 18 for SQL Server')
    DB_ENCRYPT = os.getenv('DB_ENCRYPT', 'yes')
    DB_TRUST_CERT = os.getenv('DB_TRUST_CERT', 'yes')
    
    # JWT Settings
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'dev-jwt-secret-change-in-production')
    JWT_ACCESS_TOKEN_EXPIRES = int(os.getenv('JWT_ACCESS_TOKEN_EXPIRES', 86400))  # 24 saat
    JWT_REFRESH_TOKEN_EXPIRES = int(os.getenv('JWT_REFRESH_TOKEN_EXPIRES', 2592000))  # 30 gün
    JWT_ALGORITHM = 'HS256'
    
    # Rate Limiting Settings
    # Memory storage (varsayılan) - Production için Redis kullanılabilir: redis://localhost:6379
    RATELIMIT_STORAGE_URL = os.getenv('RATELIMIT_STORAGE_URL', 'memory://')
    RATELIMIT_STRATEGY = os.getenv('RATELIMIT_STRATEGY', 'fixed-window')  # fixed-window veya moving-window
    RATELIMIT_ENABLED = os.getenv('RATELIMIT_ENABLED', 'True').lower() == 'true'
    # Tüm endpoint'ler için genel limit: 100 istek/dakika
    RATELIMIT_DEFAULT = os.getenv('RATELIMIT_DEFAULT', '100 per minute')
    
    # CORS Settings
    CORS_ORIGINS = parse_cors_origins(os.getenv('CORS_ORIGINS', 'http://localhost:3000,http://localhost:5173'))
    
    # Swagger Settings
    # Prod güvenliği: varsayılan False. DevelopmentConfig'te True yapacağız.
    SWAGGER_ENABLED = os.getenv('SWAGGER_ENABLED', 'False').lower() == 'true'
    SWAGGER_REQUIRES_AUTH = os.getenv('SWAGGER_REQUIRES_AUTH', 'True').lower() == 'true'
    
    # Raf Sistemi Settings
    MAL_KABUL_RAF_KODU = os.getenv('MAL_KABUL_RAF_KODU', 'MAL-KABUL')
    CIKIS_RAF_KODU = os.getenv('CIKIS_RAF_KODU', 'CIKIS')
    
    @property
    def DATABASE_CONNECTION_STRING(self):
        """SQL Server bağlantı string'i oluştur"""
        # ODBC'de özellikle IP,PORT kullanımlarında `tcp:` prefix'i bazı ortamlarda
        # prelogin/handshake hatalarını azaltabiliyor.
        server = (self.DB_SERVER or "").strip()
        if server and not server.lower().startswith(("tcp:", "np:", "lpc:")):
            server = f"tcp:{server}"

        connection_string = (
            f"DRIVER={{{self.DB_DRIVER}}};"
            f"SERVER={server};"
            f"DATABASE={self.DB_DATABASE};"
            f"UID={self.DB_USERNAME};"
            f"PWD={self.DB_PASSWORD};"
            f"Encrypt={self.DB_ENCRYPT};"
            f"TrustServerCertificate={self.DB_TRUST_CERT};"
        )
        return connection_string


class DevelopmentConfig(Config):
    """Development configuration"""
    DEBUG = True
    ENV = 'development'
    SWAGGER_ENABLED = True


class ProductionConfig(Config):
    """Production configuration"""
    DEBUG = False
    ENV = 'production'
    # Not: Bazı ortamlarda SQL Server self-signed sertifika kullanır (özellikle internal ağ).
    # Bu durumda ODBC Driver 18 ile Encrypt=yes iken TrustServerCertificate=yes gerekir.
    # Bu yüzden prod'da DB_TRUST_CERT değerini .env üzerinden yönetiyoruz.


class TestingConfig(Config):
    """Testing configuration"""
    TESTING = True
    DEBUG = True


# Config mapping
config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig
}

