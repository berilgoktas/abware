"""
Response utilities

Flask-RESTX ile birlikte çalışabilmesi için bu fonksiyonlar
dict döndürür, jsonify KULLANILMAZ. JSON formatına çevirme
işini Flask-RESTX kendisi yapar.
"""


def success_response(data=None, message="İşlem başarılı", status_code=200):
    """Başarılı response oluştur"""
    response = {
        "success": True,
        "message": message,
    }
    if data is not None:
        response["data"] = data
    # Flask-RESTX (Api) (data, status_code) formatını destekler
    return response, status_code


def error_response(code, message, details=None, status_code=400):
    """Hata response oluştur"""
    response = {
        "success": False,
        "error": {
            "code": code,
            "message": message,
        },
    }
    if details:
        response["error"]["details"] = details
    return response, status_code

