import os
import time
from datetime import datetime

import pytest

from app import create_app


def _env(name: str, default: str | None = None) -> str | None:
    v = os.getenv(name)
    if v is None:
        return default
    v = v.strip()
    return v if v else default


@pytest.fixture(scope="session")
def app():
    # Testler gerçek DB'ye bağlanan entegrasyon testidir.
    # .env / ortam değişkenleri ile DB bağlantısının çalıştığından emin olun.
    app = create_app(_env("FLASK_ENV", "development"))
    app.config["TESTING"] = True
    return app


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture(scope="session")
def creds():
    firma_kodu = _env("ABWARE_TEST_FIRMA_KODU")
    kullanici_adi = _env("ABWARE_TEST_KULLANICI_ADI")
    sifre = _env("ABWARE_TEST_SIFRE")

    if not (firma_kodu and kullanici_adi and sifre):
        raise RuntimeError(
            "Test credential eksik. Şunları env olarak ver:\n"
            "ABWARE_TEST_FIRMA_KODU, ABWARE_TEST_KULLANICI_ADI, ABWARE_TEST_SIFRE\n"
            "Örn (PowerShell):\n"
            "$env:ABWARE_TEST_FIRMA_KODU='DENEME'; $env:ABWARE_TEST_KULLANICI_ADI='admin'; $env:ABWARE_TEST_SIFRE='admin123'"
        )

    return {"firma_kodu": firma_kodu, "kullanici_adi": kullanici_adi, "sifre": sifre}


@pytest.fixture(scope="session")
def auth_token(app, creds):
    with app.test_client() as c:
        r = c.post(
            "/api/auth/login",
            json={
                "firma_kodu": creds["firma_kodu"],
                "kullanici_adi": creds["kullanici_adi"],
                "sifre": creds["sifre"],
            },
        )
        if r.status_code != 200:
            body = r.get_json() or {}
            if (body.get("error") or {}).get("code") == "COMPANY_INACTIVE":
                pytest.skip("Test firması pasif (COMPANY_INACTIVE). Login yapılamıyor.")
            assert r.status_code == 200, body
        body = r.get_json()
        assert body and body.get("success") is True
        token = body["data"]["token"]
        assert token
        return token


@pytest.fixture()
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


def _auth_get(client, path: str, headers: dict, query_string: dict | None = None):
    return client.get(path, headers=headers, query_string=query_string)


def _auth_post(client, path: str, headers: dict, json: dict | None = None):
    return client.post(path, headers=headers, json=json)


def _auth_put(client, path: str, headers: dict, json: dict | None = None):
    return client.put(path, headers=headers, json=json)


def test_auth_me_removed(client, auth_headers):
    # /api/auth/me endpoint kaldırıldı (istek üzerine)
    r = _auth_get(client, "/api/auth/me", auth_headers)
    assert r.status_code == 404, r.get_json()


def test_dashboard_endpoints(client, auth_headers):
    r = _auth_get(client, "/api/dashboard/stats", auth_headers)
    assert r.status_code == 200, r.get_json()

    r = _auth_get(client, "/api/dashboard/critical-stocks", auth_headers)
    assert r.status_code == 200, r.get_json()

    r = _auth_get(client, "/api/dashboard/today-transactions", auth_headers)
    assert r.status_code == 200, r.get_json()

    r = _auth_get(client, "/api/dashboard/recent-activities", auth_headers, {"period": "daily", "limit": 5})
    assert r.status_code == 200, r.get_json()


def test_products_list_and_crud_and_lookup_and_status(client, auth_headers):
    # Ürün listesi
    r = _auth_get(client, "/api/products", auth_headers)
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["success"] is True
    assert "sayfalama" in (body.get("data") or {})

    # Limit parametresiyle ürün listesi
    r = _auth_get(client, "/api/products", auth_headers, {"limit": 5})
    assert r.status_code == 200, r.get_json()
    body2 = r.get_json()
    assert body2["success"] is True
    assert (body2.get("data") or {}).get("sayfalama", {}).get("limit") == 5

    # Test ürünü oluştur (unique)
    ts = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    urun_kodu = f"TST{ts}"
    barkod = f"9{int(time.time())}12345"

    r = _auth_post(
        client,
        "/api/products",
        auth_headers,
        {
            "urun_kodu": urun_kodu,
            "urun_adi": f"Test Ürün {ts}",
            "barkod": barkod,
            "kritik_stok": 5,
            "aciklama": "pytest entegrasyon testi",
            "aktif": True,
        },
    )
    assert r.status_code in (200, 201), r.get_json()
    created = r.get_json()["data"]
    assert created and created.get("Id") is not None
    urun_id = int(created["Id"])

    # Ürün detayı
    r = _auth_get(client, f"/api/products/{urun_id}", auth_headers)
    assert r.status_code == 200, r.get_json()

    # Barkod lookup (aktif ürün)
    r = _auth_get(client, "/api/products/lookup", auth_headers, {"barkod": barkod})
    assert r.status_code == 200, r.get_json()
    lookup = r.get_json()["data"]
    assert lookup["urun_id"] == urun_id

    # Ürünü pasife al
    r = _auth_put(client, f"/api/products/{urun_id}/status", auth_headers, {"aktif": False})
    assert r.status_code == 200, r.get_json()

    # Pasif olunca lookup 404 dönmeli (aktif filtreli)
    r = _auth_get(client, "/api/products/lookup", auth_headers, {"barkod": barkod})
    assert r.status_code == 404, r.get_json()

    # Tekrar aktifleştir
    r = _auth_put(client, f"/api/products/{urun_id}/status", auth_headers, {"aktif": True})
    assert r.status_code == 200, r.get_json()


def test_transactions_move_entry_exit(client, auth_headers):
    # Önce hızlı bir test ürünü oluştur
    ts = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    urun_kodu = f"TX{ts}"
    barkod = f"8{int(time.time())}54321"

    r = _auth_post(
        client,
        "/api/products",
        auth_headers,
        {
            "urun_kodu": urun_kodu,
            "urun_adi": f"Tx Ürün {ts}",
            "barkod": barkod,
            "kritik_stok": 1,
            "aciklama": "pytest tx",
            "aktif": True,
        },
    )
    assert r.status_code in (200, 201), r.get_json()

    # Stok giriş
    r = _auth_post(client, "/api/transactions/move", auth_headers, {"barkod": barkod, "yon": "giris", "miktar": 10})
    assert r.status_code in (200, 201), r.get_json()

    # Stok çıkış
    r = _auth_post(client, "/api/transactions/move", auth_headers, {"barkod": barkod, "yon": "cikis", "miktar": 3})
    assert r.status_code in (200, 201), r.get_json()

    # İşlem listesi
    r = _auth_get(client, "/api/transactions", auth_headers)
    assert r.status_code == 200, r.get_json()


def test_users_crud_and_status(client, auth_headers):
    # Kullanıcı oluştur (unique)
    ts = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    username = f"tuser_{ts}"

    r = _auth_post(
        client,
        "/api/users",
        auth_headers,
        {
            "kullanici_adi": username,
            "sifre": "123456",
            "ad_soyad": "Pytest User",
            "email": "pytest@example.com",
            "rol_id": 3,
            "aktif": True,
        },
    )
    assert r.status_code in (200, 201), r.get_json()
    created = r.get_json()["data"]["kullanici"]
    assert created and created.get("Id") is not None
    user_id = int(created["Id"])

    # Kullanıcı güncelle
    r = _auth_put(
        client,
        f"/api/users/{user_id}",
        auth_headers,
        {"ad_soyad": "Pytest User Updated", "aktif": True},
    )
    assert r.status_code == 200, r.get_json()

    # Pasife al
    r = _auth_put(client, f"/api/users/{user_id}/status", auth_headers, {"aktif": False})
    assert r.status_code == 200, r.get_json()

    # Kullanıcı listele
    r = _auth_get(client, "/api/users", auth_headers)
    assert r.status_code == 200, r.get_json()


def test_companies_optional_for_super_admin(client, auth_headers):
    # Super admin değilse 403 dönmesi normal; super admin ise 200 beklenir.
    r = _auth_get(client, "/api/companies", auth_headers)
    assert r.status_code in (200, 403), r.get_json()


