"""
Excel rapor oluşturma yardımcı fonksiyonları
"""
from io import BytesIO
from datetime import datetime
from typing import List, Any, Dict, Optional
from flask import Response

from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill
from openpyxl.utils import get_column_letter


def create_excel_workbook() -> Workbook:
    """Yeni Excel workbook oluşturur."""
    return Workbook()


def sanitize_sheet_name(sheet_name: str) -> str:
    r"""
    Excel sayfa isimlerinde geçersiz karakterleri temizler.
    Excel'de geçersiz karakterler: / \ ? * [ ]
    Maksimum uzunluk: 31 karakter
    """
    # Geçersiz karakterleri değiştir veya kaldır
    invalid_chars = ['/', '\\', '?', '*', '[', ']', ':']
    sanitized = sheet_name
    for char in invalid_chars:
        sanitized = sanitized.replace(char, '-')
    
    # Maksimum 31 karakter (Excel limiti)
    if len(sanitized) > 31:
        sanitized = sanitized[:31]
    
    return sanitized


def add_worksheet_with_headers(
    workbook: Workbook,
    sheet_name: str,
    headers: List[str]
) -> Any:
    """
    Yeni bir worksheet oluşturur ve başlık satırını ekler.
    
    Args:
        workbook: Excel workbook
        sheet_name: Sayfa adı
        headers: Başlık listesi
    
    Returns:
        Worksheet objesi
    """
    # Varsayılan "Sheet" sayfasını sil
    if len(workbook.worksheets) == 1 and workbook.worksheets[0].title == "Sheet":
        workbook.remove(workbook.worksheets[0])
    
    # Sayfa ismini temizle
    sanitized_name = sanitize_sheet_name(sheet_name)
    worksheet = workbook.create_sheet(title=sanitized_name)
    
    # Başlık satırını ekle
    for col_idx, header in enumerate(headers, start=1):
        cell = worksheet.cell(row=1, column=col_idx, value=header)
        cell.font = Font(bold=True, size=11)
        cell.fill = PatternFill(start_color="D3D3D3", end_color="D3D3D3", fill_type="solid")
        cell.alignment = Alignment(horizontal="center", vertical="center")
    
    return worksheet


def add_data_row(worksheet: Any, row_data: List[Any], row_number: int):
    """
    Worksheet'e veri satırı ekler.
    
    Args:
        worksheet: Excel worksheet
        row_data: Satır verileri listesi
        row_number: Satır numarası (1-based)
    """
    for col_idx, value in enumerate(row_data, start=1):
        cell = worksheet.cell(row=row_number, column=col_idx, value=value)
        
        # Tarih/saat formatları için özel işleme
        if isinstance(value, datetime):
            cell.number_format = 'YYYY-MM-DD HH:MM:SS'
        elif isinstance(value, (int, float)):
            # Sayısal değerler için genel format
            cell.alignment = Alignment(horizontal="right", vertical="center")
        else:
            cell.alignment = Alignment(horizontal="left", vertical="center")


def format_headers(worksheet: Any, headers_count: int):
    """
    Başlık satırını formatlar (zaten add_worksheet_with_headers'da yapılıyor ama
    ek formatlama için kullanılabilir).
    
    Args:
        worksheet: Excel worksheet
        headers_count: Başlık sayısı
    """
    for col_idx in range(1, headers_count + 1):
        cell = worksheet.cell(row=1, column=col_idx)
        cell.font = Font(bold=True, size=11)
        cell.fill = PatternFill(start_color="D3D3D3", end_color="D3D3D3", fill_type="solid")
        cell.alignment = Alignment(horizontal="center", vertical="center")


def auto_adjust_column_widths(worksheet: Any):
    """
    Kolon genişliklerini otomatik ayarlar.
    
    Args:
        worksheet: Excel worksheet
    """
    for column in worksheet.columns:
        max_length = 0
        column_letter = get_column_letter(column[0].column)
        
        for cell in column:
            try:
                if cell.value:
                    # Hücre değerinin uzunluğunu al
                    cell_length = len(str(cell.value))
                    if cell_length > max_length:
                        max_length = cell_length
            except:
                pass
        
        # Minimum genişlik 10, maksimum 50
        adjusted_width = min(max(max_length + 2, 10), 50)
        worksheet.column_dimensions[column_letter].width = adjusted_width


def save_workbook_to_response(workbook: Workbook, filename: str) -> Response:
    """
    Workbook'u Flask response olarak döndürür.
    
    Args:
        workbook: Excel workbook
        filename: İndirilecek dosya adı (.xlsx uzantısı dahil)
    
    Returns:
        Flask Response objesi
    """
    # Workbook'u memory'de sakla
    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    
    # Response oluştur
    response = Response(
        output.read(),
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"'
        }
    )
    
    return response


def format_date_for_excel(date_value: Any) -> str:
    """
    Tarih değerini Excel için string formatına çevirir.
    
    Args:
        date_value: Tarih değeri (datetime, date veya string)
    
    Returns:
        Formatlanmış tarih string'i
    """
    if date_value is None:
        return ""
    
    if isinstance(date_value, datetime):
        return date_value.strftime('%Y-%m-%d %H:%M:%S')
    elif isinstance(date_value, str):
        return date_value
    else:
        return str(date_value)


def format_decimal_for_excel(value: Any, decimals: int = 2) -> Optional[float]:
    """
    Decimal değerini Excel için float formatına çevirir.
    
    Args:
        value: Decimal veya sayısal değer
        decimals: Ondalık basamak sayısı (varsayılan: 2)
    
    Returns:
        Float değeri veya None
    """
    if value is None:
        return None
    
    try:
        from decimal import Decimal
        if isinstance(value, Decimal):
            return float(value.quantize(Decimal('0.01')))
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None
