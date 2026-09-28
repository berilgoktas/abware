// API Base URL
const API_BASE_URL = '/api';

// Development kontrolü
const isDevelopment = import.meta.env.MODE === 'development';

// Debug: Hangi URL kullanılıyor? (sadece development'ta)
if (isDevelopment) {
  console.log('API_BASE_URL:', API_BASE_URL);
}

// Token'ı localStorage'dan al (12 saat kontrolü ile)
export const getToken = () => {
  try {
    const stored = localStorage.getItem('abware-token');
    if (!stored) {
      return null;
    }
    
    // Eski format kontrolü (string ise direkt token)
    try {
      const parsed = JSON.parse(stored);
      if (parsed.token) {
        // Yeni format (timestamp ile)
        const now = Date.now();
        const elapsed = now - parsed.timestamp;
        
        // 12 saat geçmişse temizle
        if (elapsed >= parsed.expiresIn) {
          localStorage.removeItem('abware-token');
          if (isDevelopment) {
            console.log('Token expired, cleared from localStorage');
          }
          return null;
        }
        
        return parsed.token;
      }
    } catch (parseErr) {
      // Eski format (direkt string token), geriye uyumluluk için döndür
      return stored;
    }
    
    return null;
  } catch (err) {
    if (isDevelopment) {
      console.error('Token load failed', err);
    }
    return null;
  }
};

// Token'ı localStorage'a kaydet (12 saatlik süre ile)
export const setToken = (token) => {
  try {
    const dataWithTimestamp = {
      token: token,
      timestamp: Date.now(), // Kayıt zamanı
      expiresIn: 12 * 60 * 60 * 1000, // 12 saat (milisaniye)
    };
    localStorage.setItem('abware-token', JSON.stringify(dataWithTimestamp));
  } catch (err) {
    if (isDevelopment) {
      console.error('Token save failed', err);
    }
  }
};

// Kullanıcı bilgilerini localStorage'a kaydet (12 saatlik süre ile)
export const setUserData = (userData) => {
  try {
    const dataWithTimestamp = {
      userData: userData,
      timestamp: Date.now(), // Kayıt zamanı
      expiresIn: 12 * 60 * 60 * 1000, // 12 saat (milisaniye)
    };
    localStorage.setItem('abware-user-data', JSON.stringify(dataWithTimestamp));
  } catch (err) {
    if (isDevelopment) {
      console.error('User data save failed', err);
    }
  }
};

// Kullanıcı bilgilerini localStorage'dan al (12 saat kontrolü ile)
export const getUserDataFromStorage = () => {
  try {
    const stored = localStorage.getItem('abware-user-data');
    if (!stored) {
      return null;
    }
    
    const parsed = JSON.parse(stored);
    
    // Eski format kontrolü (timestamp yoksa)
    if (!parsed.timestamp) {
      // Eski format, temizle
      localStorage.removeItem('abware-user-data');
      return null;
    }
    
    // Süre kontrolü
    const now = Date.now();
    const elapsed = now - parsed.timestamp;
    
    // 12 saat geçmişse temizle
    if (elapsed >= parsed.expiresIn) {
      localStorage.removeItem('abware-user-data');
      if (isDevelopment) {
        console.log('User data expired, cleared from localStorage');
      }
      return null;
    }
    
    return parsed.userData;
  } catch (err) {
    if (isDevelopment) {
      console.error('User data load failed', err);
    }
    // Hatalı veri varsa temizle
    try {
      localStorage.removeItem('abware-user-data');
    } catch (clearErr) {
      // Ignore
    }
    return null;
  }
};

// Refresh token'ı localStorage'dan al (12 saat kontrolü ile)
export const getRefreshToken = () => {
  try {
    const stored = localStorage.getItem('abware-refresh-token');
    if (!stored) {
      return null;
    }
    
    // Eski format kontrolü (string ise direkt token)
    try {
      const parsed = JSON.parse(stored);
      if (parsed.token) {
        // Yeni format (timestamp ile)
        const now = Date.now();
        const elapsed = now - parsed.timestamp;
        
        // 12 saat geçmişse temizle
        if (elapsed >= parsed.expiresIn) {
          localStorage.removeItem('abware-refresh-token');
          if (isDevelopment) {
            console.log('Refresh token expired, cleared from localStorage');
          }
          return null;
        }
        
        return parsed.token;
      }
    } catch (parseErr) {
      // Eski format (direkt string token), geriye uyumluluk için döndür
      return stored;
    }
    
    return null;
  } catch (err) {
    if (isDevelopment) {
      console.error('Refresh token load failed', err);
    }
    return null;
  }
};

// Refresh token'ı localStorage'a kaydet (12 saatlik süre ile)
export const setRefreshToken = (refreshToken) => {
  try {
    const dataWithTimestamp = {
      token: refreshToken,
      timestamp: Date.now(), // Kayıt zamanı
      expiresIn: 12 * 60 * 60 * 1000, // 12 saat (milisaniye)
    };
    localStorage.setItem('abware-refresh-token', JSON.stringify(dataWithTimestamp));
  } catch (err) {
    if (isDevelopment) {
      console.error('Refresh token save failed', err);
    }
  }
};

// JWT token'ı decode et (base64)
export const decodeToken = (token) => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (err) {
    return null;
  }
};

// Refresh token ile yeni access token al
export const refreshAccessToken = async () => {
  try {
    const refreshToken = getRefreshToken();
    
    if (!refreshToken) {
      throw new Error('Refresh token bulunamadı');
    }
    
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${refreshToken}`,
      },
      body: JSON.stringify({
        refresh_token: refreshToken,
      }),
    });
    
    const data = await response.json();
    
    if (data.success && data.data) {
      // Yeni token'ları sakla
      if (data.data.token) {
        setToken(data.data.token);
      }
      
      if (data.data.refresh_token) {
        setRefreshToken(data.data.refresh_token);
      }
      
      return {
        success: true,
        token: data.data.token,
        user: data.data.kullanici,
      };
    } else {
      throw new Error(data.message || 'Token yenilenemedi');
    }
  } catch (error) {
    if (isDevelopment) {
      console.error('Refresh token error:', error);
    }
    
    // Refresh token geçersizse logout yap
    clearAuth();
    return { success: false, error: error.message };
  }
};

// Kullanıcı bilgilerini token + sessionStorage'dan al
export const getUserData = async () => {
  try {
    const token = getToken();
    if (!token) {
      return null;
    }
    
    const decoded = decodeToken(token);
    if (!decoded || !decoded.sub) {
      return null;
    }
    
    const userId = parseInt(decoded.sub);
    
    // SessionStorage'dan kullanıcı adını al
    const kullaniciAdi = sessionStorage.getItem('abware-kullanici-adi') || decoded.kullanici_adi || '';
    
    // SessionStorage'dan firma bilgilerini al
    const firmaAdi = sessionStorage.getItem('abware-firma-adi') || decoded.firma_adi || decoded.firma_kodu || 'ABWare';
    const firmaKodu = sessionStorage.getItem('abware-firma-kodu') || decoded.firma_kodu || '';
    
    // Token + sessionStorage verilerini birleştir
    return {
      kullanici_id: userId,
      id: userId,
      kullanici_adi: kullaniciAdi,
      ad_soyad: decoded.ad_soyad || '',
      email: decoded.email || null,
      firma_id: decoded.firma_id || null,
      firma_kodu: firmaKodu,
      firma_adi: firmaAdi,
      is_super_admin: decoded.is_super_admin || false,
      roller: decoded.roller || [],
      aktif: decoded.aktif !== undefined ? decoded.aktif : true,
    };
  } catch (err) {
    if (isDevelopment) {
      console.error('User data load failed', err);
    }
    return null;
  }
};

// auth/me - Bearer token ile kullanıcı bilgisini API'den al
export const getAuthMe = async () => {
  try {
    const token = getToken();
    if (!token) {
      return { success: false, error: 'Token bulunamadı' };
    }

    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      cache: 'no-store',
    });

    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        clearAuth();
      }
      return { success: false, error: data.message || 'İstek başarısız' };
    }

    const userData = data.data?.kullanici || data.data || data;
    return {
      success: true,
      data: {
        kullanici_id: userData.id ?? userData.kullanici_id,
        id: userData.id ?? userData.kullanici_id,
        kullanici_adi: userData.kullanici_adi ?? '',
        ad_soyad: userData.ad_soyad ?? '',
        email: userData.email ?? null,
        firma_id: userData.firma_id ?? null,
        firma_kodu: userData.firma_kodu ?? '',
        firma_adi: userData.firma_adi ?? userData.firma_kodu ?? 'ABWare',
        is_super_admin: userData.is_super_admin ?? false,
        roller: userData.roller || [],
        aktif: userData.aktif !== undefined ? userData.aktif : true,
      },
    };
  } catch (err) {
    if (isDevelopment) {
      console.error('auth/me error:', err);
    }
    return { success: false, error: err.message };
  }
};

// Tüm auth bilgilerini temizle (logout için)
export const clearAuth = () => {
  try {
    localStorage.removeItem('abware-token');
    localStorage.removeItem('abware-refresh-token');
    localStorage.removeItem('abware-user-data');
    localStorage.removeItem('abware-ui-state');
    sessionStorage.removeItem('abware-current-view');
    sessionStorage.removeItem('abware-firma-adi');
    sessionStorage.removeItem('abware-firma-kodu');
    sessionStorage.removeItem('abware-kullanici-adi');
  } catch (err) {
    if (isDevelopment) {
      console.error('Auth clear failed', err);
    }
  }
};

// Token geçerliliğini kontrol et (auth/me ile - tüm giriş yapmış kullanıcılar erişebilir)
export const validateToken = async () => {
  const result = await getAuthMe();
  if (result.success) {
    return true;
  }
  return false;
};

// API isteği için header'ları hazırla
const getHeaders = (includeAuth = true) => {
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (includeAuth) {
    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }
  
  return headers;
};

// Login işlemi
export const login = async (firmaKodu, kullaniciAdi, sifre) => {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: getHeaders(false),
      body: JSON.stringify({
        firma_kodu: firmaKodu,
        kullanici_adi: kullaniciAdi,
        sifre: sifre,
      }),
      cache: 'no-store',
    });

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      // JSON parse hatası - response body boş veya geçersiz
      throw new Error('Sunucudan geçersiz yanıt alındı');
    }

    // 403 veya başarısız response kontrolü
    if (!response.ok || !data.success) {
      // Firma pasif hatası için özel mesaj
      if (data.error && data.error.code === 'COMPANY_INACTIVE') {
        const error = new Error(data.error.message || 'Firmanız pasife alınmıştır');
        error.code = 'COMPANY_INACTIVE';
        throw error;
      }
      throw new Error(data.error?.message || data.message || 'Giriş başarısız');
    }

    // Token'ları kaydet
    if (data.data?.token) {
      setToken(data.data.token);
    }
    if (data.data?.refresh_token) {
      setRefreshToken(data.data.refresh_token);
    }
    
    // Kullanıcı adını sessionStorage'a kaydet (sayfa yenilendiğinde kullanmak için)
    if (data.data?.kullanici?.kullanici_adi) {
      try {
        sessionStorage.setItem('abware-kullanici-adi', data.data.kullanici.kullanici_adi);
      } catch (e) {
        // SessionStorage hatası - önemli değil
      }
    }

    return data;
  } catch (error) {
    if (isDevelopment) {
      console.error('Login error:', error);
    }
    throw error;
  }
};

// Genel API isteği fonksiyonu
export const apiRequest = async (endpoint, options = {}) => {
  const { method = 'GET', body, includeAuth = true } = options;
  
  // Tüm GET istekleri için cache bypass (timestamp ekle)
  let url = `${API_BASE_URL}${endpoint}`;
  if (method === 'GET') {
    const separator = endpoint.includes('?') ? '&' : '?';
    url = `${url}${separator}_t=${Date.now()}`;
  }
  
  try {
    const response = await fetch(url, {
      method,
      headers: getHeaders(includeAuth),
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      throw new Error('Sunucudan geçersiz yanıt alındı');
    }

    if (!response.ok) {
      // Token süresi dolmuşsa veya yetkisiz erişim varsa
      if (response.status === 401) {
        clearAuth();
        throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.');
      }
      // Pasif ürün hatası için özel mesaj (sadece ürün endpoint'leri için)
      const errorMessage = data.error?.message || data.message || 'İstek başarısız';
      // Sadece ürün endpoint'lerinde pasif kontrolü yap
      if (endpoint.includes('/products/') && errorMessage.toLowerCase().includes('pasif')) {
        const error = new Error('Bu ürün pasif olduğu için kullanılamamaktır');
        error.code = 'PRODUCT_INACTIVE';
        throw error;
      }
      // Diğer hatalar için direkt mesajı gönder (JSON escape karakterleri otomatik decode edilir)
      throw new Error(errorMessage);
    }

    return data;
  } catch (error) {
    if (isDevelopment) {
      console.error('API request error:', error);
    }
    throw error;
  }
};

// Ürün ekleme
export const addProduct = async (productData) => {
  // Ölçü birimi mapping
  const adetTuruMap = {
    'adet': 'adet',
    'm': 'metre',
    'mm': 'milimetre',
    'kg': 'kilogram',
    'gr': 'gram',
  };

  const body = {
    urun_kodu: productData.code,
    urun_adi: productData.name,
    barkod: productData.barcode,
    kritik_stok: Number(productData.critical) || 0,
    fiyat_tl: Number(productData.price) || 0,
    adet_turu: adetTuruMap[productData.olcuBirimi] || productData.olcuBirimi || 'adet',
    aciklama: productData.desc || '',
    aktif: productData.status === 'active',
  };

  return await apiRequest('/products', {
    method: 'POST',
    body,
    includeAuth: true,
  });
};

// Ürün güncelleme
export const updateProduct = async (productId, productData) => {
  // Ölçü birimi mapping (eğer değiştirilebiliyorsa)
  const adetTuruMap = {
    'adet': 'adet',
    'm': 'metre',
    'mm': 'milimetre',
    'kg': 'kilogram',
    'gr': 'gram',
  };

  const body = {
    urun_kodu: productData.code,
    urun_adi: productData.name,
    barkod: productData.barcode,
    kritik_stok: Number(productData.critical) || 0,
    fiyat_tl: Number(productData.price) || 0,
    adet_turu: adetTuruMap[productData.olcuBirimi] || productData.olcuBirimi || 'adet',
    aciklama: productData.desc || '',
  };

  return await apiRequest(`/products/${productId}`, {
    method: 'PUT',
    body,
    includeAuth: true,
  });
};

// Ürün durumunu güncelle (aktif/pasif)
export const updateProductStatus = async (productId, aktif) => {
  return await apiRequest(`/products/${productId}/status`, {
    method: 'PUT',
    body: { aktif },
    includeAuth: true,
  });
};

// Tüm ürünleri getir
export const getProducts = async () => {
  return await apiRequest('/products', {
    method: 'GET',
    includeAuth: true,
  });
};

// Barkod ile ürün bilgisi getir
export const getProductByBarcode = async (barkod) => {
  return await apiRequest(`/products/lookup?barkod=${encodeURIComponent(barkod)}`, {
    method: 'GET',
    includeAuth: true,
  });
};

// Stok hareketi (giriş/çıkış) - eski move endpoint'i (sadece giriş veya diğer yerler için kullanılıyorsa)
export const addStockMovement = async (barkod, yon, miktar, aciklama) => {
  const body = {
    barkod: barkod,
    yon: yon, // "giris" veya "cikis"
    miktar: Number(miktar) || 0,
    aciklama: aciklama || '',
  };

  return await apiRequest('/transactions/move', {
    method: 'POST',
    body,
    includeAuth: true,
  });
};

// Stok çıkışı (exit-v2)
export const addStockExitV2 = async (kaynakRafBarkodu, cikisRafiBarkodu, barkod, adet, aciklama) => {
  const body = {
    kaynak_raf_barkodu: (kaynakRafBarkodu || '').trim(),
    cikis_rafi_barkodu: (cikisRafiBarkodu || '').trim(),
    barkod: (barkod || '').trim(),
    adet: Number(adet) || 0,
    aciklama: (aciklama || '').trim(),
  };

  return await apiRequest('/transactions/exit-v2', {
    method: 'POST',
    body,
    includeAuth: true,
  });
};

// Tüm kullanıcıları getir
export const getUsers = async () => {
  return await apiRequest('/users', {
    method: 'GET',
    includeAuth: true,
  });
};

// Tüm roller'i getir
export const getRoles = async () => {
  return await apiRequest('/users/roles', {
    method: 'GET',
    includeAuth: true,
  });
};

// Kullanıcı güncelleme
export const updateUser = async (userId, userData) => {
  const body = {
    kullanici_adi: userData.kullanici_adi || userData.username || '',
    ad_soyad: userData.ad_soyad || '',
    email: userData.email || '',
    rol_ids: userData.rol_ids || [],
    aktif: userData.aktif !== undefined ? userData.aktif : true,
  };

  // Şifre varsa ekle
  if (userData.password || userData.sifre) {
    body.sifre = userData.password || userData.sifre;
  }

  return await apiRequest(`/users/${userId}`, {
    method: 'PUT',
    body,
    includeAuth: true,
  });
};

// Dashboard istatistiklerini getir
export const getDashboardStats = async () => {
  return await apiRequest('/dashboard/stats', {
    method: 'GET',
    includeAuth: true,
  });
};

// Bugünkü işlemleri getir
export const getTodayTransactions = async () => {
  return await apiRequest('/dashboard/today-transactions', {
    method: 'GET',
    includeAuth: true,
  });
};

// Son aktiviteleri getir
export const getRecentActivities = async (period = 'daily', limit = 10) => {
  return await apiRequest(`/dashboard/recent-activities?period=${period}&limit=${limit}`, {
    method: 'GET',
    includeAuth: true,
  });
};

// Kritik stokları getir
export const getCriticalStocks = async () => {
  return await apiRequest('/dashboard/critical-stocks', {
    method: 'GET',
    includeAuth: true,
  });
};

// Kullanıcı ekleme
export const addUser = async (userData) => {
  const body = {
    kullanici_adi: userData.kullanici_adi || userData.username || '',
    sifre: userData.sifre || userData.password || '',
    ad_soyad: userData.ad_soyad || '',
    email: userData.email || '',
    rol_ids: userData.rol_ids || [],
    aktif: userData.aktif !== undefined ? userData.aktif : true,
  };

  return await apiRequest('/users', {
    method: 'POST',
    body,
    includeAuth: true,
  });
};

// Ürün geçmişini getir
export const getProductHistory = async (productId, limit = 50) => {
  return await apiRequest(`/products/${productId}/history?limit=${limit}`, {
    method: 'GET',
    includeAuth: true,
  });
};

// Raf yönetimi
// Tüm rafları getir
export const getRafs = async () => {
  return await apiRequest('/raflar', {
    method: 'GET',
    includeAuth: true,
  });
};

// Yeni raf ekle
export const addRaf = async (rafData) => {
  const body = {
    raf_kodu: rafData.RafKodu || rafData.rafKodu || '',
    raf_adi: rafData.RafAdi || rafData.rafAdi || '',
    raf_tipi: rafData.RafTipi || rafData.rafTipi || 'NORMAL',
    aktif: rafData.Aktif !== undefined ? rafData.Aktif : true,
  };

  return await apiRequest('/raflar', {
    method: 'POST',
    body,
    includeAuth: true,
  });
};

// Raf güncelle
export const updateRaf = async (rafId, rafData) => {
  const body = {
    raf_kodu: rafData.RafKodu || rafData.rafKodu || '',
    raf_adi: rafData.RafAdi || rafData.rafAdi || '',
    aktif: rafData.Aktif !== undefined ? rafData.Aktif : true,
  };

  return await apiRequest(`/raflar/${rafId}`, {
    method: 'PUT',
    body,
    includeAuth: true,
  });
};

// Raf sil
export const deleteRaf = async (rafId) => {
  return await apiRequest(`/raflar/${rafId}`, {
    method: 'DELETE',
    includeAuth: true,
  });
};

// Raf stok bilgisini getir
export const getRafStok = async (rafId) => {
  return await apiRequest(`/raflar/${rafId}/stok`, {
    method: 'GET',
    includeAuth: true,
  });
};

// Ürüne göre raf stok durumunu getir
export const getRafsByUrunId = async (urunId) => {
  return await apiRequest(`/raflar?urun_id=${encodeURIComponent(urunId)}`, {
    method: 'GET',
    includeAuth: true,
  });
};

// Stok girişi (v2)
export const addStockEntryV2 = async (barkod, hedefRafBarkodu, adet, aciklama, girisRafiBarkodu = '') => {
  const body = {
    barkod: barkod.trim(),
    hedef_raf_barkodu: hedefRafBarkodu.trim(),
    adet: Number(adet) || 0,
    aciklama: aciklama?.trim() || '',
    giris_rafi_barkodu: girisRafiBarkodu?.trim() || '',
  };

  return await apiRequest('/transactions/entry-v2', {
    method: 'POST',
    body,
    includeAuth: true,
  });
};

// Transfer (v2): ürün barkodu → kaynak raf → ürün tekrar → hedef raf
export const transferV2 = async (payload) => {
  const body = {
    kaynak_raf_barkodu: (payload.kaynak_raf_barkodu || '').trim(),
    barkod: (payload.barkod || '').trim(),
    adet: Number(payload.adet) || 0,
    aciklama: (payload.aciklama || '').trim(),
    hedef_raf_barkodu: (payload.hedef_raf_barkodu || '').trim(),
    hedef_urun_barkodu: (payload.hedef_urun_barkodu || payload.barkod || '').trim(),
  };

  return await apiRequest('/transactions/transfer-v2', {
    method: 'POST',
    body,
    includeAuth: true,
  });
};

// Tüm işlemleri getir
export const getTransactions = async (limit = 1000) => {
  return await apiRequest(`/transactions?limit=${limit}`, {
    method: 'GET',
    includeAuth: true,
  });
};

// Personel bazlı rapor indir (Excel)
export const downloadPersonnelReport = async (personelId, baslangicTarihi, bitisTarihi) => {
  const token = getToken();
  if (!token) {
    throw new Error('Oturum süresi dolmuş. Lütfen tekrar giriş yapın.');
  }

  // Query parametreleri oluştur
  const params = new URLSearchParams();
  if (personelId) params.append('personel_id', personelId);
  if (baslangicTarihi) params.append('baslangic_tarihi', baslangicTarihi);
  if (bitisTarihi) params.append('bitis_tarihi', bitisTarihi);

  const url = `${API_BASE_URL}/reports/personnel${params.toString() ? '?' + params.toString() : ''}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Rapor indirilemedi');
  }

  // Content-Type kontrolü
  const contentType = response.headers.get('content-type');
  
  if (contentType && contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) {
    // Excel dosyası
    const blob = await response.blob();
    const filename = `personel_rapor_${personelId}_${baslangicTarihi}_${bitisTarihi}.xlsx`;
    
    // Dosyayı indir
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
    
    return { success: true, message: 'Rapor indirildi' };
  } else {
    // JSON yanıt
    const data = await response.json();
    return data;
  }
};

// Stok raporu indir (Excel) - tarihler YYYY-MM-DD formatında gönderilir
export const downloadStockReport = async (baslangicTarihi, bitisTarihi) => {
  const token = getToken();
  if (!token) {
    throw new Error('Oturum süresi dolmuş. Lütfen tekrar giriş yapın.');
  }

  const params = new URLSearchParams();
  if (baslangicTarihi) params.append('baslangic_tarihi', baslangicTarihi);
  if (bitisTarihi) params.append('bitis_tarihi', bitisTarihi);

  const url = `${API_BASE_URL}/reports/stock${params.toString() ? '?' + params.toString() : ''}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Rapor indirilemedi');
  }

  const contentType = response.headers.get('content-type');
  
  if (contentType && contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) {
    const blob = await response.blob();
    const filename = (baslangicTarihi && bitisTarihi) ? `stok_rapor_${baslangicTarihi}_${bitisTarihi}.xlsx` : 'stok_rapor_tum.xlsx';
    
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
    
    return { success: true, message: 'Rapor indirildi' };
  } else {
    const data = await response.json();
    return data;
  }
};

