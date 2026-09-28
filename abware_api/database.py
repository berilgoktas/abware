"""
Database Connection Module
"""
import pyodbc
from config import config
import logging
import os
import threading
from datetime import datetime, date
from decimal import Decimal

logger = logging.getLogger(__name__)


class Database:
    """Database connection manager"""

    def _is_comm_link_failure(self, err: Exception) -> bool:
        """
        ODBC iletişim kopması / bağlantı düşmesi (örn: 08S01) durumlarını yakalamak için.
        Bu hatalarda mevcut connection çoğu zaman bozulmuş olur; reconnect gerekir.
        """
        try:
            # pyodbc.Error çoğunlukla args[0] içinde SQLSTATE taşır
            if hasattr(err, "args") and err.args:
                sqlstate = str(err.args[0])
                if sqlstate == "08S01":
                    return True
            msg = str(err) or ""
            return "08S01" in msg or "Communication link failure" in msg
        except Exception:
            return False

    def _should_reset_connection(self, err: Exception) -> bool:
        """Bağlantıyı bir sonraki istekte yeniden kurmayı gerektiren ODBC hataları."""
        if self._is_comm_link_failure(err):
            return True
        try:
            sqlstate = str(err.args[0]) if hasattr(err, "args") and err.args else ""
            if sqlstate in {"HY000", "HY010", "24000", "08S01"}:
                return True
            msg = (str(err) or "").lower()
            return any(
                token in msg
                for token in ("busy", "meşgul", "imleç", "cursor", "function sequence")
            )
        except Exception:
            return False

    def _should_log_db_debug(self) -> bool:
        """
        DB bağlantı denemesinden önce debug bilgi logla mı?
        - Varsayılan: FLASK_DEBUG=true iken loglar
        - İstersen DB_DEBUG_LOG=true ile de zorlayabilirsin
        """
        env_force = os.getenv("DB_DEBUG_LOG", "").strip().lower() in {"1", "true", "yes", "on"}
        if env_force:
            return True
        try:
            return bool(getattr(self.config, "DEBUG", False))
        except Exception:
            return False

    def _mask(self, value: str, keep_start: int = 1, keep_end: int = 1) -> str:
        """Hassas verileri loglarken maskeler (şifre asla düz yazı görünmez)."""
        if value is None:
            return ""
        s = str(value)
        if len(s) <= (keep_start + keep_end):
            return "*" * len(s)
        return f"{s[:keep_start]}***{s[-keep_end:]}"
    
    def _normalize_server(self, raw_server: str) -> str:
        """ODBC için SERVER değerini normalize et (ip,port -> tcp:ip,port)."""
        server = (raw_server or "").strip()
        if server and not server.lower().startswith(("tcp:", "np:", "lpc:")):
            server = f"tcp:{server}"
        return server

    def _build_connection_string(self, driver_name: str) -> str:
        """Seçilen ODBC driver ile connection string üret."""
        c = self.config
        server = self._normalize_server(getattr(c, "DB_SERVER", ""))
        return (
            f"DRIVER={{{driver_name}}};"
            f"SERVER={server};"
            f"DATABASE={c.DB_DATABASE};"
            f"UID={c.DB_USERNAME};"
            f"PWD={c.DB_PASSWORD};"
            f"Encrypt={c.DB_ENCRYPT};"
            f"TrustServerCertificate={c.DB_TRUST_CERT};"
            "MARS_Connection=yes;"
        )

    def _candidate_drivers(self) -> list[str]:
        """Makinede yüklü sürücülere göre denenecek driver listesini üret."""
        configured = (getattr(self.config, "DB_DRIVER", "") or "").strip()
        preferred = []
        if configured:
            preferred.append(configured)
        # TLS/Encrypt uyumluluğu için 18'i önce denemek genelde daha iyi
        preferred.extend(["ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server"])

        # sırayı bozmayacak şekilde unique
        seen = set()
        ordered = []
        for d in preferred:
            if d and d not in seen:
                seen.add(d)
                ordered.append(d)

        installed = {d.strip() for d in pyodbc.drivers()}
        if installed:
            filtered = [d for d in ordered if d in installed]
            if filtered:
                return filtered
        return ordered or ([configured] if configured else [])

    def __init__(self):
        # Uygulama hangi ortamda çalışıyorsa (development/production/testing),
        # DB ayarları da aynı config sınıfından okunmalı.
        env_name = (os.getenv("FLASK_ENV", "development") or "development").strip().lower()
        self.config = config.get(env_name, config["default"])()
        self._local = threading.local()

    @property
    def connection(self):
        return getattr(self._local, "connection", None)

    @connection.setter
    def connection(self, value):
        self._local.connection = value
    
    def connect(self):
        """Veritabanı bağlantısı oluştur"""
        last_error: pyodbc.Error | None = None
        drivers = self._candidate_drivers()
        if not drivers:
            # fallback: config'ten gelen string'i dene
            drivers = [(getattr(self.config, "DB_DRIVER", "") or "").strip()]

        for driver in drivers:
            if not driver:
                continue
            try:
                if self._should_log_db_debug():
                    c = self.config
                    server = self._normalize_server(getattr(c, "DB_SERVER", ""))
                    logger.info(
                        "DB debug: server=%s database=%s user=%s encrypt=%s trust_cert=%s driver_try=%s",
                        server,
                        getattr(c, "DB_DATABASE", ""),
                        self._mask(getattr(c, "DB_USERNAME", ""), keep_start=1, keep_end=1),
                        getattr(c, "DB_ENCRYPT", ""),
                        getattr(c, "DB_TRUST_CERT", ""),
                        driver,
                    )
                connection_string = self._build_connection_string(driver)
                # Bazı sürücü/ortam kombinasyonlarında connection string içindeki timeout
                # anahtarları "Invalid connection string attribute" verebiliyor.
                # Bu yüzden timeout'u pyodbc parametresi olarak veriyoruz.
                self.connection = pyodbc.connect(connection_string, timeout=30)
                self.connection.autocommit = False
                logger.info(f"Veritabanı bağlantısı başarılı (driver: {driver})")
                return self.connection
            except pyodbc.Error as e:
                last_error = e
                logger.error(f"Veritabanı bağlantı hatası (driver: {driver}): {str(e)}")

        # tüm denemeler başarısızsa son hatayı fırlat
        raise last_error if last_error else pyodbc.Error("Veritabanı bağlantısı kurulamadı")
    
    def disconnect(self):
        """Veritabanı bağlantısını kapat"""
        if self.connection:
            self.connection.close()
            self.connection = None
            logger.info("Veritabanı bağlantısı kapatıldı")
    
    def get_connection(self):
        """Mevcut bağlantıyı döndür, yoksa yeni bağlantı oluştur"""
        if self.connection is None:
            self.connect()
        return self.connection
    
    def execute_query(self, query, params=None, fetch=True):
        """Query çalıştır"""
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            
            if params:
                cursor.execute(query, params)
            else:
                cursor.execute(query)
            
            if fetch:
                # SELECT sorguları için
                if cursor.description:
                    columns = [column[0] for column in cursor.description]
                    rows = cursor.fetchall()

                    def _serialize_value(value):
                        """JSON'a dönüştürülebilir tipe çevir."""
                        if isinstance(value, (datetime, date)):
                            return value.isoformat()
                        if isinstance(value, Decimal):
                            return float(value)
                        return value

                    result = [
                        {
                            col: _serialize_value(val)
                            for col, val in zip(columns, row)
                        }
                        for row in rows
                    ]
                    cursor.close()
                    return result
                else:
                    cursor.close()
                    return []
            else:
                # INSERT, UPDATE, DELETE sorguları için
                rowcount = cursor.rowcount
                try:
                    conn.commit()
                except pyodbc.Error as e:
                    # commit sırasında bağlantı düştüyse connection bozulmuştur
                    if self._should_reset_connection(e):
                        try:
                            self.disconnect()
                        except Exception:
                            pass
                    raise
                cursor.close()
                return rowcount
        except pyodbc.Error as e:
            if self.connection:
                try:
                    self.connection.rollback()
                except Exception:
                    # rollback sırasında da bağlantı kopmuş olabilir
                    pass
            # iletişim hatasında connection'ı düşür ki sonraki istek reconnect etsin
            if self._should_reset_connection(e):
                try:
                    self.disconnect()
                except Exception:
                    pass
            logger.error(f"Query hatası: {str(e)}")
            raise
    
    def execute_procedure(self, procedure_name, params=None):
        """Stored procedure çalıştır"""
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            
            if params:
                cursor.execute(f"EXEC {procedure_name}", params)
            else:
                cursor.execute(f"EXEC {procedure_name}")
            
            columns = [column[0] for column in cursor.description]
            rows = cursor.fetchall()

            def _serialize_value(value):
                if isinstance(value, (datetime, date)):
                    return value.isoformat()
                if isinstance(value, Decimal):
                    return float(value)
                return value

            result = [
                {
                    col: _serialize_value(val)
                    for col, val in zip(columns, row)
                }
                for row in rows
            ]
            
            try:
                conn.commit()
            except pyodbc.Error as e:
                if self._should_reset_connection(e):
                    try:
                        self.disconnect()
                    except Exception:
                        pass
                raise
            cursor.close()
            return result
        except pyodbc.Error as e:
            if self.connection:
                try:
                    self.connection.rollback()
                except Exception:
                    pass
            if self._should_reset_connection(e):
                try:
                    self.disconnect()
                except Exception:
                    pass
            logger.error(f"Procedure hatası: {str(e)}")
            raise


# Global database instance
db = Database()

