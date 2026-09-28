# ABWare - Stok Hareketi Format Test Script
# Kullanım: .\test_islem_tipi_format.ps1

$BASE_URL = "http://localhost:5000"  # veya "https://webservis.abware.com.tr"
$FIRMA_KODU = "DENEME"  # Kendi firma kodunu yaz
$KULLANICI_ADI = "admin"  # Kendi kullanıcı adını yaz
$SIFRE = "admin123"  # Kendi şifreni yaz

Write-Host "=== ABWare Stok Hareketi Format Test ===" -ForegroundColor Cyan
Write-Host ""

# 1) Login
Write-Host "1. Login yapılıyor..." -ForegroundColor Yellow
$loginBody = @{
    firma_kodu = $FIRMA_KODU
    kullanici_adi = $KULLANICI_ADI
    sifre = $SIFRE
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod -Uri "$BASE_URL/api/auth/login" `
    -Method POST `
    -ContentType "application/json" `
    -Body $loginBody

$token = $loginResponse.data.token
Write-Host "✓ Login başarılı! Token alındı." -ForegroundColor Green
Write-Host ""

# 2) Stok hareketi yap (giriş)
Write-Host "2. Stok girişi yapılıyor..." -ForegroundColor Yellow
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

# Önce bir ürün bul (barkod ile)
# Not: Kendi barkodunu kullan
$barkod = "123456789"  # Test için bir barkod yaz

$stokBody = @{
    barkod = $barkod
    miktar = 10
    aciklama = "Test stok hareketi (giris): 10 adet | Not: deneme açıklama"
} | ConvertTo-Json

try {
    $stokResponse = Invoke-RestMethod -Uri "$BASE_URL/api/transactions/entry" `
        -Method POST `
        -Headers $headers `
        -Body $stokBody
    
    Write-Host "✓ Stok girişi başarılı!" -ForegroundColor Green
    Write-Host ""
    
    # 3) Stok hareketleri listesini al
    Write-Host "3. Stok hareketleri listesi alınıyor..." -ForegroundColor Yellow
    $listResponse = Invoke-RestMethod -Uri "$BASE_URL/api/transactions?limit=5" `
        -Method GET `
        -Headers $headers
    
    Write-Host ""
    Write-Host "=== TEST SONUÇLARI ===" -ForegroundColor Cyan
    Write-Host ""
    
    if ($listResponse.data.islemler.Count -gt 0) {
        $sonIslem = $listResponse.data.islemler[0]
        
        Write-Host "Son işlem:" -ForegroundColor Yellow
        Write-Host "  ID: $($sonIslem.Id)"
        Write-Host "  İşlem Tipi: $($sonIslem.IslemTipi)" -ForegroundColor $(if ($sonIslem.IslemTipi -eq "Giriş" -or $sonIslem.IslemTipi -eq "Çıkış") { "Green" } else { "Red" })
        Write-Host "  Açıklama: $($sonIslem.Aciklama)" -ForegroundColor $(if ($sonIslem.Aciklama -match "Giriş|Çıkış") { "Green" } else { "Red" })
        Write-Host ""
        
        # Kontrol
        if ($sonIslem.IslemTipi -eq "Giriş" -or $sonIslem.IslemTipi -eq "Çıkış") {
            Write-Host "✓ islem_tipi formatı DOĞRU: '$($sonIslem.IslemTipi)'" -ForegroundColor Green
        } else {
            Write-Host "✗ islem_tipi formatı YANLIŞ: '$($sonIslem.IslemTipi)' (beklenen: 'Giriş' veya 'Çıkış')" -ForegroundColor Red
        }
        
        if ($sonIslem.Aciklama -match "Giriş|Çıkış") {
            Write-Host "✓ Aciklama içinde format DOĞRU: Türkçe karakterli görünüyor" -ForegroundColor Green
        } else {
            Write-Host "✗ Aciklama formatı kontrol edilemedi veya 'giris'/'cikis' görünüyor" -ForegroundColor Yellow
        }
    } else {
        Write-Host "✗ Stok hareketi bulunamadı!" -ForegroundColor Red
    }
    
} catch {
    Write-Host "✗ Hata: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Not: Önce bir ürün oluşturman veya mevcut bir barkod kullanman gerekebilir." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Test Tamamlandı ===" -ForegroundColor Cyan


