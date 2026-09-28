import { useState, useMemo, useEffect, useRef } from 'react';
import StockInPage from './StockInPage';
import ProductForm from './ProductForm';
import RafPage from './RafPage';
import ReportsPage from './ReportsPage';
import { calculateProductStocks, getTodayMovements, getCriticalProducts, getRecentMovements, getProducts as getProductsLocal, getUsers, addUser, updateUser, authenticateUser, getUserById, updateProduct, isBarcodeExists, isCodeExists, addProductActivity } from './storage';
import { login as apiLogin, clearAuth, getUserData, getToken, validateToken, decodeToken, getAuthMe, getProducts as getProductsAPI, updateProduct as updateProductAPI, updateProductStatus as updateProductStatusAPI, getUsers as getUsersAPI, getRoles as getRolesAPI, updateUser as updateUserAPI, addUser as addUserAPI, getCriticalStocks as getCriticalStocksAPI, getDashboardStats as getDashboardStatsAPI, getTodayTransactions as getTodayTransactionsAPI, getRecentActivities as getRecentActivitiesAPI, getProductHistory as getProductHistoryAPI, getRafs as getRafsAPI, getRafStok as getRafStokAPI, getRafsByUrunId as getRafsByUrunIdAPI, getProductByBarcode as getProductByBarcodeAPI, addStockEntryV2, getTransactions as getTransactionsAPI } from './api';
import { listenToMessages, broadcastMessage } from './broadcastChannel';

// StockProductDetailModal için refresh trigger
let stockEntryRefreshTrigger = 0;
import firmaLogo from './assets/orns.png';
const logoImage = '/logo.png';

// Development modu kontrolü
const isDevelopment = import.meta.env.MODE === 'development' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

function SplashScreen({ firmaAdi, kullaniciAdi, firmaKodu, isClosing }) {
  // Firma koduna göre farklı açılış ekranları
  const isOkdemir = firmaKodu && firmaKodu.toUpperCase() === 'OKDEMİR';
  
  return (
    <div
      className={`fixed inset-0 flex items-center justify-center z-[9999] overflow-hidden transition-opacity duration-500 ${
        isClosing ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ background: isOkdemir ? '#F8F8F8' : 'linear-gradient(135deg, #f8fafc 0%, #e6fffa 100%)' }}
    >
      {isOkdemir ? (
        // OKDEMİR için özel açılış ekranı
        <>
          <div className="absolute inset-0 flex items-center justify-center">
            <img
              src={firmaLogo}
              alt={`${firmaAdi} Logo`}
              className="w-full h-full object-cover sm:w-auto sm:h-auto sm:max-w-[80vw] sm:max-h-[80vh] sm:object-contain"
            />
          </div>
          <div className="relative z-10 flex flex-col items-center justify-center gap-6 text-center">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-primary-900 drop-shadow-lg">
              {kullaniciAdi ? `${kullaniciAdi}, Hoş Geldiniz` : 'Hoş Geldiniz'}
            </h1>
            <div className="flex flex-col items-center gap-3">
              <div className="flex gap-2">
                <div className="w-2.5 h-2.5 bg-accent-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2.5 h-2.5 bg-accent-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2.5 h-2.5 bg-accent-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
              <p className="text-sm sm:text-base text-primary-700 font-medium">Yükleniyor...</p>
            </div>
          </div>
        </>
      ) : (
        // Diğer firmalar için genel açılış ekranı
        <div className="relative z-10 flex flex-col items-center justify-center gap-6 text-center px-4 animate-fade-in">
          <div className="w-24 h-24 sm:w-32 sm:h-32 bg-white rounded-2xl shadow-elevated flex items-center justify-center mb-4">
            <svg className="w-12 h-12 sm:w-16 sm:h-16 text-accent-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-primary-900">
            {firmaAdi || 'ABWare'}
          </h1>
          <h2 className="text-xl sm:text-2xl md:text-3xl font-semibold text-primary-600">
            {kullaniciAdi ? `${kullaniciAdi}, Hoş Geldiniz` : 'Hoş Geldiniz'}
          </h2>
          <div className="flex flex-col items-center gap-3 mt-4">
            <div className="flex gap-2">
              <div className="w-2.5 h-2.5 bg-accent-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2.5 h-2.5 bg-accent-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2.5 h-2.5 bg-accent-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
            <p className="text-sm sm:text-base text-primary-600 font-medium">Yükleniyor...</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  // Portre/landscape arasında otomatik dengeleme için aralık kullan
  const headerTranslateY = 'clamp(-60px, -6vw, -20px)';
  const [firmaKodu, setFirmaKodu] = useState('');
  const [kullanici, setKullanici] = useState('');
  const [sifre, setSifre] = useState('');
  const [sonuc, setSonuc] = useState('');
  // Güvenlik: localStorage'dan gelen girisYapildi'ye güvenme, token kontrolü yapılacak
  const [girisYapildi, setGirisYapildi] = useState(false);
  const [aktifKullanici, setAktifKullanici] = useState('');
  const [aktifKullaniciId, setAktifKullaniciId] = useState(null);
  const [aktifFirma, setAktifFirma] = useState('ABWare');
  // View state'i her zaman 'menu' ile başlar (sayfa yenilendiğinde state'ler sıfırlanır)
  const [view, setView] = useState('menu');
  
  // View değiştiğinde sessionStorage'a kaydet ve history state ekle
  useEffect(() => {
    try {
      sessionStorage.setItem('abware-current-view', view);
      // View değiştiğinde history state ekle (geri tuşu için)
      if (view !== 'menu') {
        window.history.pushState({ view }, '', window.location.href);
      }
    } catch (err) {
      if (isDevelopment) {
        console.error('View save failed', err);
      }
    }
  }, [view]);

  // Geri tuşu (back button) için event listener
  useEffect(() => {
    const handlePopState = (event) => {
      // Geri tuşuna basıldığında menüye dön
      if (girisYapildi && view !== 'menu') {
        setView('menu');
        // History'yi güncelle
        window.history.pushState({ view: 'menu' }, '', window.location.href);
      }
    };

    window.addEventListener('popstate', handlePopState);
    
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [view, girisYapildi]);
  const [authChecking, setAuthChecking] = useState(true); // Token kontrolü yapılıyor mu?
  const [installEvent, setInstallEvent] = useState(null);
  const [installStatus, setInstallStatus] = useState('');
  const [installDismissed, setInstallDismissed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [demoModal, setDemoModal] = useState(false);
  const [showSplash, setShowSplash] = useState(false);
  const [splashClosing, setSplashClosing] = useState(false);

  // Giriş yapıldığında açılış ekranını göster ve 2.5 saniye sonra kapat
  useEffect(() => {
    if (girisYapildi && showSplash) {
      const fadeOutTimer = setTimeout(() => {
        setSplashClosing(true);
      }, 2000);
      const closeTimer = setTimeout(() => {
        setShowSplash(false);
        setSplashClosing(false);
      }, 2500);
      return () => {
        clearTimeout(fadeOutTimer);
        clearTimeout(closeTimer);
      };
    }
  }, [girisYapildi, showSplash]);

  // Menüye dönüldüğünde sayfayı en üste kaydır
  useEffect(() => {
    if (view === 'menu' && girisYapildi) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [view, girisYapildi]);

  // Kullanıcı bilgisi silinirse otomatik logout yap
  useEffect(() => {
    if (girisYapildi && !authChecking && !aktifKullanici) {
      // Kullanıcı adı boş, logout yap
      clearAuth();
      setGirisYapildi(false);
      setAktifKullanici('');
      setAktifKullaniciId(null);
      setAktifFirma('ABWare');
      setView('menu');
    }
  }, [girisYapildi, authChecking, aktifKullanici]);

  // localStorage kullanılmıyor, state sadece memory'de tutuluyor

  // Güvenlik: Sayfa yüklendiğinde token kontrolü yap
  useEffect(() => {
    const checkAuth = async () => {
      setAuthChecking(true);
      const token = getToken();
      
      if (!token) {
        // Token yoksa, localStorage'dan gelen state'i temizle
        clearAuth();
        setGirisYapildi(false);
        // View'ı auth kontrolü bittikten sonra değiştir (setTimeout ile)
        setAuthChecking(false);
        // View'ı sadece menu değilse değiştir - auth kontrolü bittikten sonra
        setTimeout(() => {
          if (view !== 'menu') {
            setView('menu');
          }
        }, 0);
        return;
      }
      
      // Token varsa geçerliliğini kontrol et
      const isValid = await validateToken();
      
      // validateToken içinde zaten 401/403 durumunda clearAuth çağrılıyor
      // Eğer isValid false ise ve token hala varsa, bu network hatası olabilir
      // Bu durumda token'ı koruyup kullanıcıyı giriş yapmış olarak bırak
      if (!isValid) {
        // Token hala varsa (clearAuth çağrılmadıysa), network hatası olabilir
        const tokenStillExists = getToken();
        if (!tokenStillExists) {
          // Token gerçekten temizlendiyse (401/403), logout yap
          setGirisYapildi(false);
          setAuthChecking(false);
          // View'ı auth kontrolü bittikten sonra değiştir
          setTimeout(() => {
            if (view !== 'menu') {
              setView('menu');
            }
          }, 0);
          return;
        }
        // Token hala varsa, network hatası olabilir, token'ı koru
        // Kullanıcı bilgilerini yükle ve giriş yapmış olarak bırak
      }
      
      // Token geçerliyse, kullanıcı bilgilerini API'den yükle
      if (isValid || tokenStillExists) {
        try {
          const apiUserData = await getUserData();
          if (apiUserData) {
            setGirisYapildi(true);
            setAktifKullanici(apiUserData.kullanici_adi || apiUserData.ad_soyad || '');
            setAktifKullaniciId(apiUserData.id || null);
            // Firma bilgisi önce sessionStorage'dan, sonra token'dan, son olarak API'den al
            let firmaAdi = '';
            try {
              firmaAdi = sessionStorage.getItem('abware-firma-adi') || '';
            } catch (err) {
              // SessionStorage hatası
            }
            setAktifFirma(firmaAdi || apiUserData.firma_adi || apiUserData.firma_kodu || 'ABWare');
            // View'ı değiştirme, sessionStorage'dan zaten yüklenmiş
          } else {
            // getUserData null döndüyse bile token geçerliyse giriş yapmış say
            // Token'dan bilgileri çıkar
            const decoded = decodeToken(token);
            if (decoded) {
              // Firma bilgisi önce sessionStorage'dan, sonra token'dan al
              let firmaAdi = '';
              try {
                firmaAdi = sessionStorage.getItem('abware-firma-adi') || '';
              } catch (err) {
                // SessionStorage hatası
              }
              setGirisYapildi(true);
              setAktifKullanici(decoded.kullanici_adi || decoded.ad_soyad || '');
              setAktifKullaniciId(parseInt(decoded.sub) || null);
              setAktifFirma(firmaAdi || decoded.firma_adi || decoded.firma_kodu || 'ABWare');
            } else {
              // Token decode edilemediyse logout
              setGirisYapildi(false);
              // View'ı auth kontrolü bittikten sonra değiştir
              setTimeout(() => {
                if (view !== 'menu') {
                  setView('menu');
                }
              }, 0);
            }
          }
        } catch (err) {
          // API hatası durumunda token varsa token'dan bilgileri çıkar
          if (token) {
            try {
              const decoded = decodeToken(token);
              if (decoded) {
                // Firma bilgisi önce sessionStorage'dan, sonra token'dan al
                let firmaAdi = '';
                try {
                  firmaAdi = sessionStorage.getItem('abware-firma-adi') || '';
                } catch (err) {
                  // SessionStorage hatası
                }
                setGirisYapildi(true);
                setAktifKullanici(decoded.kullanici_adi || decoded.ad_soyad || '');
                setAktifKullaniciId(parseInt(decoded.sub) || null);
                setAktifFirma(firmaAdi || decoded.firma_adi || decoded.firma_kodu || 'ABWare');
              } else {
                setGirisYapildi(false);
                // View'ı auth kontrolü bittikten sonra değiştir
                setTimeout(() => {
                  if (view !== 'menu') {
                    setView('menu');
                  }
                }, 0);
              }
            } catch (decodeErr) {
              setGirisYapildi(false);
              // View'ı auth kontrolü bittikten sonra değiştir
              setTimeout(() => {
                if (view !== 'menu') {
                  setView('menu');
                }
              }, 0);
            }
          } else {
            setGirisYapildi(false);
            // View'ı auth kontrolü bittikten sonra değiştir
            setTimeout(() => {
              if (view !== 'menu') {
                setView('menu');
              }
            }, 0);
          }
        }
      } else {
        // Token yok veya geçersiz, logout
        setGirisYapildi(false);
        // View'ı auth kontrolü bittikten sonra değiştir
        setTimeout(() => {
          if (view !== 'menu') {
            setView('menu');
          }
        }, 0);
      }
      
      setAuthChecking(false);
    };
    
    checkAuth();
  }, []); // Sadece component mount olduğunda çalış
    
  // Aktif kullanıcının bilgilerini state'te tut
  const [apiUserData, setApiUserData] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [kullaniciIzinleri, setKullaniciIzinleri] = useState([]);
  
  // Kullanıcı bilgilerini API'den yükle ve periyodik olarak güncelle
  useEffect(() => {
    const loadUserData = async () => {
      if (!girisYapildi) {
        setApiUserData(null);
        setIsAdmin(false);
        setKullaniciIzinleri([]);
        return;
      }
      
      try {
        const userData = await getUserData();
        if (userData) {
          setApiUserData(userData);
          setIsAdmin(userData.is_super_admin || false);
          const rollerMap = {
            'Kullanıcı Yönetimi': 'user_manage',
            'Stok Durumu': 'stock_view',
            'Ürün Ekle': 'product_manage',
            'Stok Giriş / Çıkış': 'stock_movement',
            'Kontrol Paneli': 'dashboard',
            'Raporlar': 'reports',
            'Kritik stok düzenleme': 'critical_stock',
            'Stok Durumu Güncelleme': 'stock_status_update',
            'Stok Durum Fiyat': 'stock_price_view',
          };
          const izinler = (userData.roller || []).map(rol => rollerMap[rol] || rol).filter(Boolean);
          setKullaniciIzinleri(izinler);
        } else {
          setApiUserData(null);
          setIsAdmin(false);
          setKullaniciIzinleri([]);
        }
      } catch (err) {
        setApiUserData(null);
        setIsAdmin(false);
        setKullaniciIzinleri([]);
      }
    };
    
    // İlk yükleme
    loadUserData();
  }, [girisYapildi]);
  
  // Token kontrolü - giriş yapıldıktan sonra periyodik kontrol
  useEffect(() => {
    if (!girisYapildi) return;
    
    const token = getToken();
    if (!token) {
      // Token yoksa çıkış yap
      clearAuth();
      setGirisYapildi(false);
      setKullanici('');
      setSifre('');
      setSonuc('');
      setAktifFirma('');
      setAktifKullaniciId(null);
      setView('menu');
      setShowSplash(false);
      setSplashClosing(false);
    }
  }, [girisYapildi]);

  // View değiştiğinde auth/me çağrısı - menü (geri dön) ve sayfa girişinde
  useEffect(() => {
    if (authChecking) return;
    
    const token = getToken();
    if (!token) {
      if (girisYapildi) {
        clearAuth();
        setGirisYapildi(false);
        if (view !== 'menu') setView('menu');
      }
      return;
    }
    
    if (!girisYapildi) {
      if (view !== 'menu') setView('menu');
      return;
    }
    
    const checkAuthAndPermission = async () => {
      const result = await getAuthMe();
      if (!result.success) {
        clearAuth();
        setGirisYapildi(false);
        setView('menu');
        return;
      }
      
      const userData = result.data;
      setApiUserData(userData);
      setIsAdmin(userData.is_super_admin || false);
      const rollerMap = {
        'Kullanıcı Yönetimi': 'user_manage',
        'Stok Durumu': 'stock_view',
        'Ürün Ekle': 'product_manage',
        'Stok Giriş / Çıkış': 'stock_movement',
        'Kontrol Paneli': 'dashboard',
        'Raporlar': 'reports',
        'Kritik stok düzenleme': 'critical_stock',
        'Stok Durumu Güncelleme': 'stock_status_update',
        'Stok Durum Fiyat': 'stock_price_view',
      };
      const izinler = (userData.roller || []).map(rol => rollerMap[rol] || rol).filter(Boolean);
      setKullaniciIzinleri(izinler);
      
      if (view === 'menu') return;
      
      let hasAccess = false;
      if (view === 'dashboard') {
        hasAccess = izinler.includes('dashboard') || izinler.includes('reports');
      } else if (view === 'stock') {
        hasAccess = izinler.includes('stock_view');
      } else if (view === 'stock-in') {
        hasAccess = izinler.includes('stock_movement');
      } else if (view === 'product-form') {
        hasAccess = izinler.includes('product_manage');
      } else if (view === 'user-management') {
        hasAccess = izinler.includes('user_manage');
      } else if (view === 'raf-management') {
        hasAccess = izinler.includes('stock_movement');
      } else if (view === 'reports') {
        hasAccess = izinler.includes('reports');
      }
      
      if (!hasAccess) {
        setTimeout(() => setView('menu'), 2000);
      }
    };
    checkAuthAndPermission();
  }, [view, girisYapildi, authChecking]);

  const menuItems = useMemo(() => {
    const allItems = [
      { key: 'dashboard', label: 'Kontrol Paneli', badge: 0, icon: 'dashboard', permission: 'dashboard' },
      { key: 'warehouse', label: 'Stok Durumu', badge: 1, icon: 'product', permission: 'stock_view' },
      { key: 'shipments', label: 'Ürün Ekle', badge: 2, icon: 'plus-box', permission: 'product_manage' },
      { key: 'returns', label: 'Stok Giriş / Çıkış', badge: 0, icon: 'arrows-swap', permission: 'stock_movement' },
      { key: 'raf-management', label: 'Raf Yönetimi', badge: 0, icon: 'list', permission: 'stock_movement' },
      { key: 'production', label: 'Kullanıcı Yönetimi', badge: 0, icon: 'users', permission: 'user_manage' },
      { key: 'articles', label: 'Raporlar', badge: 0, icon: 'list', permission: 'reports' },
    ];

    // Sadece roller listesindeki izinlere göre menüyü filtrele
    return allItems.filter(item => {
      if (!item.permission) return true;
      return kullaniciIzinleri.includes(item.permission);
    });
  }, [kullaniciIzinleri]);
  
  // Erişilebilir sayfa sayısını hesapla
  const erisilebilirSayfaSayisi = useMemo(() => {
    const accessibleViews = new Set();
    if (kullaniciIzinleri.includes('user_manage')) accessibleViews.add('user-management');
    if (kullaniciIzinleri.includes('product_manage')) accessibleViews.add('product-form');
    if (kullaniciIzinleri.includes('stock_view')) accessibleViews.add('stock');
    if (kullaniciIzinleri.includes('stock_movement')) accessibleViews.add('stock-in');
    if (kullaniciIzinleri.includes('dashboard')) accessibleViews.add('dashboard');
    if (kullaniciIzinleri.includes('reports')) accessibleViews.add('reports');
    return accessibleViews.size;
  }, [kullaniciIzinleri, menuItems.length]);
  
  const tekSayfaErisimi = erisilebilirSayfaSayisi === 1;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSonuc('');
    
    try {
      // API'ye login isteği gönder
      const response = await apiLogin(firmaKodu, kullanici, sifre);
      
      if (response.success && response.data) {
        const { kullanici: userData, firma_id, firma_kodu, firma_adi } = response.data;
        
        // API'den gelen roller array'ini permissions'a çevir
        const rollerMap = {
          'Kullanıcı Yönetimi': 'user_manage',
          'Stok Durumu': 'stock_view',
          'Ürün Ekle': 'product_manage',
          'Stok Giriş / Çıkış': 'stock_movement',
          'Kontrol Paneli': 'dashboard',
          'Raporlar': 'reports',
          'Kritik stok düzenleme': 'critical_stock',
        };
        
        const permissions = (userData.roller || []).map(rol => rollerMap[rol] || rol).filter(Boolean);
        
        // Super admin ise tüm izinleri ver
        const isAdmin = userData.is_super_admin || false;
        const finalPermissions = isAdmin 
          ? ['user_manage', 'product_manage', 'stock_view', 'stock_movement', 'dashboard', 'reports', 'critical_stock']
          : permissions;
        
        // Login response'undan firma bilgisini al (en güncel ve doğru)
        const firmaAdiFromResponse = firma_adi || userData?.firma_adi || '';
        const firmaKoduFromResponse = firma_kodu || userData?.firma_kodu || '';
        
        // Firma bilgisini sessionStorage'a kaydet (sayfa yenilendiğinde kullanmak için)
        try {
          if (firmaAdiFromResponse) {
            sessionStorage.setItem('abware-firma-adi', firmaAdiFromResponse);
          }
          if (firmaKoduFromResponse) {
            sessionStorage.setItem('abware-firma-kodu', firmaKoduFromResponse);
          }
        } catch (err) {
          // SessionStorage hatası
        }
        
        setGirisYapildi(true);
        setAktifKullanici(userData.kullanici_adi || userData.ad_soyad || kullanici);
        setAktifKullaniciId(userData.id);
        setAktifFirma(firmaAdiFromResponse || firmaKoduFromResponse || firmaKodu || 'ABWare');
        setSonuc('');
        setShowSplash(true);
        
        // Eğer admin değilse, erişebileceği sayfa sayısını kontrol et
        let targetView = 'menu';
        if (!isAdmin) {
          // İzinlere göre erişilebilir sayfaları belirle
          const accessibleViews = new Set();
          
          if (finalPermissions.includes('user_manage')) {
            accessibleViews.add('user-management');
          }
          if (finalPermissions.includes('product_manage')) {
            accessibleViews.add('product-form');
          }
          if (finalPermissions.includes('stock_view')) {
            accessibleViews.add('stock');
          }
          if (finalPermissions.includes('stock_movement')) {
            accessibleViews.add('stock-in');
          }
          if (finalPermissions.includes('dashboard')) {
            accessibleViews.add('dashboard');
          }
          if (finalPermissions.includes('reports')) {
            accessibleViews.add('dashboard');
          }
          
          // Eğer sadece 1 sayfaya erişimi varsa direkt o sayfaya yönlendir
          if (accessibleViews.size === 1) {
            targetView = Array.from(accessibleViews)[0];
          }
        }
        
        setView(targetView);
      } else {
        setSonuc(response.message || 'Giriş başarısız.');
      }
    } catch (error) {
      if (isDevelopment) {
        console.error('Login error:', error);
      }
      // Firma pasif hatası için özel mesaj
      if (error.code === 'COMPANY_INACTIVE') {
        setSonuc('Firmanız Pasife Alınmıştır');
      } else {
        setSonuc(error.message || 'Giriş başarısız. Lütfen tekrar deneyin.');
      }
    }
  };

  const handleLogout = () => {
    // API token'larını temizle
    clearAuth();
    
    setGirisYapildi(false);
    setKullanici('');
    setSifre('');
    setSonuc('');
    setAktifFirma('');
    setAktifKullaniciId(null);
    setView('menu');
    setShowSplash(false);
    setSplashClosing(false);
  };

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Kullanıcı yetkisi değiştiğinde güncel verileri çek (BroadcastChannel - aynı tarayıcı)
  useEffect(() => {
    const handlePermissionsUpdate = async (message) => {
      if (message.type === 'user-permissions-updated' && message.data.userId) {
        if (apiUserData && apiUserData.kullanici_id === message.data.userId) {
          try {
            const result = await getAuthMe();
            if (result.success && result.data) {
              const userData = result.data;
              setApiUserData(userData);
              setIsAdmin(userData.is_super_admin || false);
              const rollerMap = {
                'Kullanıcı Yönetimi': 'user_manage',
                'Stok Durumu': 'stock_view',
                'Ürün Ekle': 'product_manage',
                'Stok Giriş / Çıkış': 'stock_movement',
                'Kontrol Paneli': 'dashboard',
                'Raporlar': 'reports',
                'Kritik stok düzenleme': 'critical_stock',
                'Stok Durumu Güncelleme': 'stock_status_update',
                'Stok Durum Fiyat': 'stock_price_view',
              };
              const izinler = (userData.roller || []).map(rol => rollerMap[rol] || rol).filter(Boolean);
              setKullaniciIzinleri(izinler);
              if (isDevelopment) {
                console.log('✓ Rolleriniz güncellendi!');
              }
            }
          } catch (err) {
            if (isDevelopment) {
              console.error('Kullanıcı verisi alınamadı', err);
            }
          }
        }
      }
    };
    const cleanup = listenToMessages(handlePermissionsUpdate);
    return () => cleanup();
  }, [apiUserData]);

  const handleInstall = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    setInstallStatus(outcome === 'accepted' ? 'Yükleme başlatıldı' : 'Yükleme iptal edildi');
    setInstallEvent(null);
  };

  const handleInstallDismiss = () => {
    setInstallDismissed(true);
    setInstallEvent(null);
  };

  const isStockView = girisYapildi && view === 'stock';

  // Token kontrolü yapılıyorsa loading göster
  if (authChecking) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <div className="text-center animate-fade-in">
          <div className="flex gap-2 justify-center mb-4">
            <div className="w-2.5 h-2.5 bg-accent-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
            <div className="w-2.5 h-2.5 bg-accent-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
            <div className="w-2.5 h-2.5 bg-accent-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
          </div>
          <p className="text-sm font-medium text-primary-600">Yükleniyor...</p>
        </div>
      </div>
    );
  }

  // Açılış ekranı gösteriliyorsa sadece splash screen'i render et (sadece giriş yapıldıktan sonra)
  // Sadece OKDEMİR firması için açılış ekranı göster
  if (showSplash && girisYapildi) {
    const loginFirmaKodu = firmaKodu || aktifFirma || '';
    // OKDEMİR ise açılış ekranını göster
    if (loginFirmaKodu.toUpperCase() === 'OKDEMİR') {
      return <SplashScreen firmaAdi={aktifFirma || firmaKodu || 'ABWare'} kullaniciAdi={aktifKullanici} firmaKodu={loginFirmaKodu} isClosing={splashClosing} />;
    }
    // Diğer firmalar için de açılış ekranı göster
    return <SplashScreen firmaAdi={aktifFirma || firmaKodu || 'ABWare'} kullaniciAdi={aktifKullanici} firmaKodu={loginFirmaKodu} isClosing={splashClosing} />;
  }

  return (
    <div
      className={`min-h-screen text-primary-900 flex flex-col relative transition-opacity duration-500 gradient-overlay ${
        !showSplash && girisYapildi ? 'opacity-100 animate-fade-in' : 'opacity-100'
      }`}
      style={{ backgroundColor: '#f8fafc' }}
    >
      <header className="w-full px-5 py-3.5 flex items-center justify-between fixed top-0 left-0 right-0 z-50 header-blur border-b border-gray-200/50" style={{ backgroundColor: 'rgba(255, 255, 255, 0.95)' }}>
        <p className="text-xl font-bold text-primary-900 tracking-wide" style={{ fontFamily: 'Inter, system-ui, sans-serif', letterSpacing: '0.08em' }}>ABWARE</p>
        
        {girisYapildi && (
          <UserMenuButton
            firmaAdi={aktifFirma || 'ABWare'}
            kullaniciAdi={aktifKullanici}
            onLogout={handleLogout}
            isOpen={userMenuOpen}
            onToggle={() => setUserMenuOpen(!userMenuOpen)}
            onClose={() => setUserMenuOpen(false)}
          />
        )}
      </header>

      <div 
        className={`flex-1 overflow-y-auto pt-20 pb-20 ${isStockView || view === 'user-management' || view === 'dashboard' || view === 'stock-in' || view === 'product-form' || view === 'raf-management' || view === 'reports' ? '' : 'flex items-center justify-center'}`}
        style={{ backgroundColor: '#ffffff' }}
      >
        <div
          className={`w-full ${isStockView ? 'max-w-5xl' : 'max-w-sm'} mx-auto px-4 sm:px-5 ${isStockView || view === 'user-management' || view === 'dashboard' || view === 'stock-in' || view === 'product-form' || view === 'raf-management' || view === 'reports' ? 'pt-4' : ''} ${view === 'menu' || !girisYapildi ? 'flex flex-col items-center justify-center min-h-full' : ''}`}
        >

        {!girisYapildi ? (
          <form onSubmit={handleSubmit} className="space-y-6 w-full animate-fade-in-up">
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-primary-600">
                Firma Kodu
              </label>
              <input
                type="text"
                placeholder="Firma kodunuzu girin"
                value={firmaKodu}
                onChange={(e) => setFirmaKodu(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-base text-primary-900 placeholder:text-gray-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 focus:outline-none transition-all duration-200"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-primary-600">
                Kullanıcı Adı
              </label>
              <input
                type="text"
                placeholder="Kullanıcı adınızı girin"
                value={kullanici}
                onChange={(e) => setKullanici(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-base text-primary-900 placeholder:text-gray-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 focus:outline-none transition-all duration-200"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-primary-600">
                Şifre
              </label>
              <input
                type="password"
                placeholder="••••••••"
                value={sifre}
                onChange={(e) => setSifre(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-base text-primary-900 placeholder:text-gray-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 focus:outline-none transition-all duration-200"
              />
            </div>

            <div className="flex items-center gap-2.5 pt-1">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-accent-600 focus:ring-2 focus:ring-accent-500 focus:ring-offset-0 transition-colors"
              />
              <span className="text-sm text-primary-600">Beni hatırla</span>
            </div>

            <button
              type="submit"
              className="w-full bg-primary-800 text-white py-4 rounded-xl text-base font-semibold hover:bg-primary-900 active:scale-[0.98] transition-all duration-200 shadow-soft hover:shadow-elevated mt-2"
            >
              Giriş Yap
            </button>

            {sonuc && (
              <p className="text-center text-sm text-primary-700 pt-1 animate-fade-in" aria-live="polite">
                {sonuc}
              </p>
            )}
          </form>
        ) : view === 'menu' ? (
          <nav className="space-y-4 sm:space-y-6 animate-fade-in-up" aria-label="ABWare menü">
            <div className={tekSayfaErisimi ? "flex flex-col items-center justify-center gap-6 sm:gap-8 md:gap-10 w-full" : "grid grid-cols-2 gap-6 sm:gap-8 md:gap-10"}>
              {menuItems.map((item) => (
                <MenuButton
                  key={item.key}
                  item={item}
                  onClick={() => {
                if (item.key === 'dashboard') setView('dashboard');
                if (item.key === 'warehouse') setView('stock');
                if (item.key === 'returns') setView('stock-in');
                if (item.key === 'shipments') setView('product-form');
                if (item.key === 'raf-management') setView('raf-management');
                if (item.key === 'production') setView('user-management');
                if (item.key === 'articles') setView('reports');
                  }}
                />
              ))}
            </div>
            {demoModal && <DemoModal key="demo-modal-menu" onClose={() => setDemoModal(false)} />}
          </nav>
        ) : !authChecking ? (
          <>
            {view === 'dashboard' && (kullaniciIzinleri.includes('dashboard') || kullaniciIzinleri.includes('reports')) && (
              <DashboardView onBack={() => setView('menu')} aktifFirma={aktifFirma} key={`dashboard-${view}`} />
            )}
            {view === 'stock' && kullaniciIzinleri.includes('stock_view') && (
              <StockPage 
                onBack={() => setView('menu')} 
                aktifFirma={aktifFirma} 
                isAdmin={isAdmin} 
                canUpdateStock={isAdmin || kullaniciIzinleri.includes('stock_status_update')}
                canViewPrice={isAdmin || kullaniciIzinleri.includes('stock_price_view')}
                key={`stock-${view}`} 
              />
            )}
            {view === 'stock-in' && kullaniciIzinleri.includes('stock_movement') && (
              <StockInPage onBack={() => setView('menu')} aktifFirma={aktifFirma} key={`stock-in-${view}`} />
            )}
            {view === 'product-form' && kullaniciIzinleri.includes('product_manage') && (
              <ProductForm onBack={() => setView('menu')} aktifFirma={aktifFirma} key={`product-form-${view}`} />
            )}
            {view === 'user-management' && kullaniciIzinleri.includes('user_manage') && (
              <UserManagementView 
                onBack={() => setView('menu')} 
                aktifFirma={aktifFirma} 
                currentUserId={apiUserData?.kullanici_id}
                key={`user-management-${view}`} 
              />
            )}
            {view === 'raf-management' && kullaniciIzinleri.includes('stock_movement') && (
              <RafPage onBack={() => setView('menu')} aktifFirma={aktifFirma} key={`raf-management-${view}`} />
            )}
            {view === 'reports' && kullaniciIzinleri.includes('reports') && (
              <ReportsPage onBack={() => setView('menu')} key={`reports-${view}`} />
            )}
            {view !== 'menu' && 
              !(view === 'dashboard' && (kullaniciIzinleri.includes('dashboard') || kullaniciIzinleri.includes('reports'))) &&
              !(view === 'stock' && kullaniciIzinleri.includes('stock_view')) &&
              !(view === 'stock-in' && kullaniciIzinleri.includes('stock_movement')) &&
              !(view === 'product-form' && kullaniciIzinleri.includes('product_manage')) &&
              !(view === 'user-management' && kullaniciIzinleri.includes('user_manage')) &&
              !(view === 'raf-management' && kullaniciIzinleri.includes('stock_movement')) &&
              !(view === 'reports' && kullaniciIzinleri.includes('reports')) && (
                <div className="text-center py-12 animate-fade-in" key="no-access">
                  <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <p className="text-primary-600 font-medium">Bu sayfaya yetkiniz yoktur.</p>
                  <button
                    type="button"
                    onClick={() => setView('menu')}
                    className="mt-4 text-sm text-accent-600 font-semibold hover:text-accent-700 transition-colors"
                  >
                    ← Menüye dön
                  </button>
                </div>
              )
            }
          </>
        ) : null}
        </div>
      </div>

      <footer className="w-full bg-primary-900 text-white py-4 px-4 sm:px-5">
        <div className={`w-full ${isStockView ? 'max-w-5xl' : 'max-w-sm'} mx-auto flex items-center justify-between text-xs text-primary-200`}>
          <span>© 2025 ABWare Teams. Tüm hakları saklıdır.</span>
          <span className="text-primary-300 font-medium">v1.1.2</span>
        </div>
      </footer>
    </div>
  );
}


function MenuButton({ item, onClick }) {
  return (
    <button
      type="button"
      className="menu-button relative flex flex-col items-center justify-center gap-3 sm:gap-4 group"
      onClick={onClick}
    >
      <div
        className="flex items-center justify-center rounded-2xl shadow-card w-36 h-36 sm:w-40 sm:h-40 md:w-44 md:h-44 transition-all duration-300 group-hover:shadow-elevated border border-gray-100"
        style={{
          background: 'linear-gradient(135deg, #e6fffa 0%, #b2f5ea 100%)',
        }}
      >
        <MenuIcon name={item.icon} />
      </div>
      <span className="text-sm sm:text-base text-primary-800 font-semibold text-center px-1">{item.label}</span>
    </button>
  );
}

function DashboardView({ onBack, aktifFirma }) {
  const [kritikAcil, setKritikAcil] = useState(false);
  const [criticalProducts, setCriticalProducts] = useState([]);
  const [criticalCount, setCriticalCount] = useState(0);
  const [totalProducts, setTotalProducts] = useState(0);
  const [todayIn, setTodayIn] = useState(0);
  const [todayOut, setTodayOut] = useState(0);
  const [recentMovements, setRecentMovements] = useState([]);
  const [loadingCritical, setLoadingCritical] = useState(false);
  const [selectedCriticalProduct, setSelectedCriticalProduct] = useState(null);
  const [demoModal, setDemoModal] = useState(false);
  const [currentPageMovements, setCurrentPageMovements] = useState(1);
  const [itemsPerPageMovements, setItemsPerPageMovements] = useState(10);
  const [dashboardData, setDashboardData] = useState({
    totalProducts: 0,
    criticalCount: 0,
    todayIn: 0,
    todayOut: 0,
    criticalProducts: [],
    recentMovements: [],
  });

  // API'den dashboard istatistiklerini çek
  const loadDashboardStats = async () => {
      try {
        const response = await getDashboardStatsAPI();
        
        // Response formatını kontrol et
        if (response && response.data) {
          setTotalProducts(response.data.toplam_urun || response.data.toplamUrun || 0);
          setCriticalCount(response.data.kritik_stok_sayisi || response.data.kritikStokSayisi || 0);
        } else if (response && response.success && response.data) {
          setTotalProducts(response.data.toplam_urun || response.data.toplamUrun || 0);
          setCriticalCount(response.data.kritik_stok_sayisi || response.data.kritikStokSayisi || 0);
        }
      } catch (err) {
        if (isDevelopment) {
          console.error('Dashboard istatistikleri yüklenemedi', err);
        }
        // Hata durumunda 0 olarak kalacak
      }
    };

  const loadTodayTransactions = async () => {
      try {
        const response = await getTodayTransactionsAPI();
        
        // Response formatını kontrol et
        if (response && response.data) {
          const giris = response.data.giris || {};
          const cikis = response.data.cikis || {};
          setTodayIn(giris.toplam_miktar || giris.toplamMiktar || 0);
          setTodayOut(cikis.toplam_miktar || cikis.toplamMiktar || 0);
        } else if (response && response.success && response.data) {
          const giris = response.data.giris || {};
          const cikis = response.data.cikis || {};
          setTodayIn(giris.toplam_miktar || giris.toplamMiktar || 0);
          setTodayOut(cikis.toplam_miktar || cikis.toplamMiktar || 0);
        }
      } catch (err) {
        if (isDevelopment) {
          console.error('Bugünkü işlemler yüklenemedi', err);
        }
        // Hata durumunda 0 olarak kalacak
      }
    };

  const loadRecentActivities = async () => {
      try {
        // Günlük verilerin hepsini çek (limit yok veya çok yüksek)
        const response = await getRecentActivitiesAPI('daily', 10000);
        
        // Response formatını kontrol et
        let activitiesArray = [];
        if (response && response.data) {
          if (response.data.aktiviteler && Array.isArray(response.data.aktiviteler)) {
            activitiesArray = response.data.aktiviteler;
          } else if (Array.isArray(response.data)) {
            activitiesArray = response.data;
          }
        } else if (response && response.success && response.data) {
          if (response.data.aktiviteler && Array.isArray(response.data.aktiviteler)) {
            activitiesArray = response.data.aktiviteler;
          } else if (Array.isArray(response.data)) {
            activitiesArray = response.data;
          }
        }
        
        // API'den gelen veriyi frontend formatına çevir
        const formatted = activitiesArray.map((activity) => {
          const tarih = new Date(activity.Tarih || activity.tarih);
          const hours = String(tarih.getHours()).padStart(2, '0');
          const minutes = String(tarih.getMinutes()).padStart(2, '0');
          const day = String(tarih.getDate()).padStart(2, '0');
          const month = String(tarih.getMonth() + 1).padStart(2, '0');
          const year = tarih.getFullYear();
          
          // İşlem tipine göre icon ve type belirle
          let icon = 'arrows-swap';
          const aciklama = activity.Aciklama || activity.aciklama || '';
          let type = aciklama;
          
          const islemTipi = activity.IslemTipi || activity.islem_tipi || '';
          
          // Önce açıklama içinde "(giris)" veya "(cikis)" bilgisini kontrol et (en güvenilir)
          const aciklamaLower = aciklama.toLowerCase();
          const hasGiris = aciklamaLower.includes('(giris') || aciklamaLower.includes('(giriş');
          const hasCikis = aciklamaLower.includes('(cikis') || aciklamaLower.includes('(çıkış') || aciklamaLower.includes('(cıkış');
          
          // Açıklamada (giris) veya (cikis) bilgisi varsa ona göre icon ve type belirle
          let cleanType = '';
          if (hasGiris && !hasCikis) {
            icon = 'plus';
            cleanType = 'Stok Girişi';
          } else if (hasCikis && !hasGiris) {
            icon = 'minus';
            cleanType = 'Stok Çıkışı';
          } else if (islemTipi === 'Giriş' || islemTipi === 'stok_giris') {
            // Açıklamada bilgi yoksa IslemTipi'ne bak
            icon = 'plus';
            cleanType = 'Stok Girişi';
          } else if (islemTipi === 'Çıkış' || islemTipi === 'stok_cikis') {
            icon = 'minus';
            cleanType = 'Stok Çıkışı';
          } else if (islemTipi === 'stok_hareket') {
            // stok_hareket tipinde açıklamada (giris) veya (cikis) bilgisi yoksa varsayılan
            if (hasGiris) {
              icon = 'plus';
              cleanType = 'Stok Girişi';
            } else if (hasCikis) {
              icon = 'minus';
              cleanType = 'Stok Çıkışı';
            } else {
              icon = 'arrows-swap';
              cleanType = 'Stok Hareketi';
            }
          } else if (islemTipi === 'urun_ekleme') {
            icon = 'plus-box';
            cleanType = 'Ürün Eklendi';
          } else if (islemTipi === 'urun_guncelleme') {
            icon = 'edit';
            cleanType = 'Ürün Güncellendi';
          } else if (islemTipi === 'urun_durum') {
            icon = 'status-change';
            cleanType = 'Ürün Durumu Değiştirildi';
          } else {
            // Varsayılan: açıklamayı kullan ama "| Not:" kısmını çıkar
            cleanType = aciklama || islemTipi || 'İşlem';
            const notIndex = cleanType.indexOf('| Not:');
            if (notIndex !== -1) {
              cleanType = cleanType.substring(0, notIndex).trim();
            }
          }
          
          // Description'dan "Not: " kısmından sonrasını al (Açıklama için)
          // Sadece ilk kelimeyi veya noktadan önceki kısmı al
          let cleanDescription = '';
          const notIndexInDesc = aciklama.indexOf('Not: ');
          if (notIndexInDesc !== -1) {
            let descText = aciklama.substring(notIndexInDesc + 5).trim();
            // İlk noktadan önceki kısmı al
            const dotIndex = descText.indexOf('.');
            if (dotIndex !== -1) {
              cleanDescription = descText.substring(0, dotIndex).trim();
            } else {
              // Nokta yoksa, sadece ilk kelimeyi al
              const firstWord = descText.split(/\s+/)[0];
              cleanDescription = firstWord || '';
            }
          } else {
            // Eğer "Not: " yoksa, "| Not:" formatını kontrol et
            const pipeNotIndex = aciklama.indexOf('| Not:');
            if (pipeNotIndex !== -1) {
              let descText = aciklama.substring(pipeNotIndex + 6).trim();
              // İlk noktadan önceki kısmı al
              const dotIndex = descText.indexOf('.');
              if (dotIndex !== -1) {
                cleanDescription = descText.substring(0, dotIndex).trim();
              } else {
                // Nokta yoksa, sadece ilk kelimeyi al
                const firstWord = descText.split(/\s+/)[0];
                cleanDescription = firstWord || '';
              }
            }
          }
          
          // Acıklamadan miktar çıkar (eğer varsa)
          let adet = null;
          const adetMatch = aciklama.match(/(\d+)\s*adet/);
          if (adetMatch) {
            adet = parseInt(adetMatch[1]);
          }
          
          return {
            id: activity.Id || activity.id,
            name: activity.UrunAdi || activity.urun_adi || activity.UrunAd || activity.urun_ad || '',
            type: cleanType,
            time: `${hours}:${minutes}`,
            date: `${day}.${month}.${year}`,
            icon: icon,
            adet: adet,
            productCode: activity.UrunKodu || activity.urun_kodu || '',
            timestamp: activity.Tarih || activity.tarih,
            username: activity.KullaniciAdSoyad || activity.kullanici_ad_soyad || '',
            description: cleanDescription,
          };
        });
        
        setRecentMovements(formatted);
      } catch (err) {
        if (isDevelopment) {
          console.error('Son aktiviteler yüklenemedi', err);
        }
        setRecentMovements([]);
      }
    };

  // Son hareketler listesi değiştiğinde sayfayı sıfırla
  useEffect(() => {
    setCurrentPageMovements(1);
  }, [recentMovements.length]);

  // Sayfa açıldığında hemen çalıştır
  useEffect(() => {
    loadDashboardStats();
    loadTodayTransactions();
    loadRecentActivities();
  }, []);

  // BroadcastChannel ile tüm tab/window'lardan güncellemeleri dinle
  useEffect(() => {
    const handleDataUpdate = (message) => {
      if (message.type === 'stock-movement' || message.type === 'product-added' || message.type === 'product-updated' || message.type === 'data-updated') {
        // API'den güncel verileri tekrar çek
        loadDashboardStats();
        loadTodayTransactions();
        loadRecentActivities();
      }
    };
    const cleanup = listenToMessages(handleDataUpdate);
    return () => {
      cleanup();
    };
  }, []);

  // Farklı cihazlardan gelen güncellemeler için polling (her 5 saniyede bir)
  useEffect(() => {
    let intervalId = null;
    
    const startPolling = () => {
      // Sayfa görünürse polling başlat
      if (document.visibilityState === 'visible') {
        intervalId = setInterval(() => {
          loadDashboardStats();
          loadTodayTransactions();
          loadRecentActivities();
        }, 5000); // 5 saniyede bir
      }
    };
    
    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    
    // Sayfa görünürlük değişikliklerini dinle
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Sayfa görünür olduğunda hemen veri çek ve polling başlat
        loadDashboardStats();
        loadTodayTransactions();
        loadRecentActivities();
        startPolling();
      } else {
        // Sayfa gizlendiğinde polling'i durdur
        stopPolling();
      }
    };
    
    // İlk yüklemede polling başlat
    startPolling();
    
    // Sayfa görünürlük değişikliklerini dinle
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const summary = [
    {
      key: 'total',
      label: 'Toplam Ürün',
      value: totalProducts.toLocaleString('tr-TR'),
      icon: 'product',
    },
    {
      key: 'critical',
      label: 'Kritik Stok',
      value: criticalCount.toString(),
      icon: 'alert',
      accent: criticalCount > 0 ? 'red' : null,
    },
    {
      key: 'movement',
      label: 'Bugün Hareket',
      value: `+${todayIn} / -${todayOut}`,
      icon: 'balance',
    },
    {
      key: 'count',
      label: 'Sayım Durumu',
      value: 'Aktif',
      icon: 'checklist',
      badge: 'Aktif',
      disabled: true,
    },
  ];

  const [hareketDetay, setHareketDetay] = useState(null);

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-900">Kontrol Paneli</h2>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-neutral-700 underline underline-offset-4"
        >
          Menüye dön
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {summary.map((card) => {
          const handleCardClick = async () => {
            if (card.key === 'critical') {
              setLoadingCritical(true);
              try {
                // Tüm ürünleri /api/products endpoint'inden çek
                const response = await getProductsAPI();
                let productsArray = [];
                
                // Response formatını kontrol et
                if (Array.isArray(response)) {
                  productsArray = response;
                } else if (response && response.data) {
                  if (Array.isArray(response.data)) {
                    productsArray = response.data;
                  } else if (response.data.items && Array.isArray(response.data.items)) {
                    productsArray = response.data.items;
                  } else if (response.data.products && Array.isArray(response.data.products)) {
                    productsArray = response.data.products;
                  } else if (typeof response.data === 'object') {
                    const values = Object.values(response.data);
                    const arrayValue = values.find(v => Array.isArray(v));
                    if (arrayValue) {
                      productsArray = arrayValue;
                    }
                  }
                }
                
                // Önce sadece aktif ürünleri filtrele
                const activeProducts = productsArray.filter((product) => {
                  const aktif = product.Aktif !== undefined ? product.Aktif : (product.aktif !== undefined ? product.aktif : true);
                  return aktif === true;
                });
                
                // Kritik stokları filtrele (mevcut stok < kritik stok ve aktif olanlar)
                const criticalArray = activeProducts.filter((product) => {
                  const reelStok = product.ReelStok || product.reel_stok || product.Stok || product.stok || 0;
                  const kritikStok = product.KritikStok || product.kritik_stok || product.Kritik || product.kritik || 0;
                  return reelStok < kritikStok;
                });
                
                // API'den gelen veriyi frontend formatına çevir
                const formatted = criticalArray.map((item) => ({
                  id: item.Id || item.id,
                  ad: item.UrunAdi || item.urun_adi || item.Ad || item.ad || '',
                  kod: item.UrunKodu || item.urun_kodu || item.Kod || item.kod || '',
                  barkod: item.Barkod || item.barkod || item.BarkodNo || item.barkod_no || item.barcode || '',
                  kritik: item.KritikStok || item.kritik_stok || item.Kritik || item.kritik || 0,
                  stok: item.ReelStok || item.reel_stok || item.Stok || item.stok || 0,
                  olcuBirimi: item.AdetTuru || item.adet_turu || 'adet',
                  aciklama: item.Aciklama || item.aciklama || '',
                  aktif: item.Aktif !== undefined ? item.Aktif : (item.aktif !== undefined ? item.aktif : true),
                  toplamGiris: item.ToplamGiris || item.toplam_giris || 0,
                  toplamCikis: item.ToplamCikis || item.toplam_cikis || 0,
                }));
                
                setCriticalProducts(formatted);
                setCriticalCount(formatted.length);
                setKritikAcil(true);
              } catch (err) {
                if (isDevelopment) {
                  console.error('Kritik stoklar yüklenemedi', err);
                }
                setCriticalProducts([]);
                setKritikAcil(true);
              } finally {
                setLoadingCritical(false);
              }
            }
            if (card.disabled) setDemoModal(true);
          };
          return (
            <button
              key={card.key}
              type="button"
              onClick={handleCardClick}
              className={`w-full text-left rounded-xl px-4 py-3 space-y-2 border ${
                card.disabled
                  ? 'bg-neutral-100 border-neutral-200 text-neutral-400 cursor-not-allowed'
                  : 'bg-white border-neutral-200 text-neutral-900'
              }`}
            >
              <div className="flex items-center justify-between">
                <SmallIcon name={card.icon} />
                {card.accent === 'red' && (
                  <span className="text-[11px] font-semibold text-red-600">!</span>
                )}
                {card.badge && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
                    {card.badge}
                  </span>
                )}
              </div>
              <div className="text-2xl font-semibold text-neutral-900">{card.value}</div>
              <div className="text-xs text-neutral-600">{card.label}</div>
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-neutral-800">Son hareketler</h3>
        {(() => {
          const totalPages = Math.ceil(recentMovements.length / itemsPerPageMovements);
          const startIndex = (currentPageMovements - 1) * itemsPerPageMovements;
          const endIndex = startIndex + itemsPerPageMovements;
          const paginatedMovements = recentMovements.slice(startIndex, endIndex);
          
          return (
            <>
              <div className="divide-y divide-neutral-200 border border-neutral-200 rounded-xl bg-white max-h-96 overflow-y-auto">
                {recentMovements.length > 0 ? (
                  paginatedMovements.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setHareketDetay(row)}
                className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-neutral-50"
              >
                <SmallIcon name={row.icon} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-neutral-600">
                    {row.productCode && <div className="text-sm font-bold text-neutral-900 mb-1">Ürün Kodu: {row.productCode}</div>}
                    <div className="font-medium">İşlem: {row.type}</div>
                    {row.description && <div className="mt-1">Açıklama: {row.description}</div>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs text-neutral-500">{row.date}</div>
                  <div className="text-xs text-neutral-500">{row.time}</div>
                </div>
                  </button>
                  ))
                ) : (
                  <div className="px-4 py-6 text-center text-neutral-500 text-sm">
                    Henüz hareket kaydı yok
                  </div>
                )}
              </div>
              {recentMovements.length > 0 && (
                <Pagination
                  currentPage={currentPageMovements}
                  totalPages={totalPages}
                  itemsPerPage={10}
                  totalItems={recentMovements.length}
                  onPageChange={setCurrentPageMovements}
                />
              )}
            </>
          );
        })()}
      </div>

      {kritikAcil && (
        <CriticalModal 
          key="critical-modal"
          onClose={() => setKritikAcil(false)} 
          items={criticalProducts} 
          loading={loadingCritical}
          onProductClick={(product) => setSelectedCriticalProduct(product)}
        />
      )}
      {selectedCriticalProduct && (
        <CriticalProductDetailModal 
          key="critical-detail-modal"
          product={selectedCriticalProduct}
          onClose={() => setSelectedCriticalProduct(null)}
        />
      )}
      {hareketDetay && (
        <MovementModal key="movement-modal" onClose={() => setHareketDetay(null)} item={hareketDetay} />
      )}
      {demoModal && <DemoModal key="demo-modal" onClose={() => setDemoModal(false)} />}
    </section>
  );
}

function CriticalModal({ onClose, items, loading, onProductClick }) {
  return (
    <div className="fixed inset-0 bg-black/25 flex items-center justify-center px-4 z-50">
      <div className="w-full max-w-sm rounded-2xl bg-white border border-neutral-200 flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between p-5 shrink-0">
          <h4 className="text-base font-semibold text-neutral-900">Kritik Stok Detayı</h4>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-neutral-600 underline underline-offset-4"
          >
            Kapat
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-5">
          {loading ? (
            <div className="text-center py-8 text-neutral-600">Yükleniyor...</div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-neutral-600">Kritik stok bulunmamaktadır.</div>
          ) : (
            <div className="divide-y divide-neutral-200">
              {items.map((row, index) => (
                <button
                  key={row.id || row.ad || index}
                  type="button"
                  onClick={() => onProductClick(row)}
                  className="w-full flex items-center justify-between py-3 hover:bg-neutral-50 transition-colors"
                >
                  <div className="flex-1 text-left">
                    <div className="text-sm text-neutral-900">{row.ad}</div>
                    <div className="text-xs text-neutral-600">
                      Kritik: {row.kritik} • Stok: {row.stok}
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-red-600 ml-2">Kritik</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CriticalProductDetailModal({ product, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/25 flex items-center justify-center px-4 z-50">
      <div className="w-full max-w-md bg-white border border-neutral-300 rounded-2xl shadow-lg max-h-[90vh] overflow-y-auto">
        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base sm:text-lg font-semibold text-neutral-900">Ürün Detayları</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-neutral-600 underline underline-offset-4"
            >
              Kapat
            </button>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Ürün Adı
              </label>
              <div className="text-sm text-neutral-900 font-medium">{product.ad || '-'}</div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Ürün Kodu
              </label>
              <div className="text-sm text-neutral-900">{product.kod || '-'}</div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Barkod
              </label>
              <div className="text-sm text-neutral-900">{product.barkod || '-'}</div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wide text-neutral-600">
                  Mevcut Stok
                </label>
                <div className="text-sm text-neutral-900 font-semibold">{product.stok || 0}</div>
              </div>
              <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wide text-neutral-600">
                  Kritik Stok
                </label>
                <div className="text-sm text-red-600 font-semibold">{product.kritik || 0}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wide text-neutral-600">
                  Toplam Giriş
                </label>
                <div className="text-sm text-neutral-900">{product.toplamGiris || 0}</div>
              </div>
              <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wide text-neutral-600">
                  Toplam Çıkış
                </label>
                <div className="text-sm text-neutral-900">{product.toplamCikis || 0}</div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Ölçü Birimi
              </label>
              <div className="text-sm text-neutral-900">{product.olcuBirimi || 'adet'}</div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Durum
              </label>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                  product.aktif ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-200 text-neutral-600'
                }`}>
                  {product.aktif ? 'Aktif' : 'Pasif'}
                </span>
              </div>
            </div>

            {product.aciklama && (
              <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wide text-neutral-600">
                  Açıklama
                </label>
                <div className="text-sm text-neutral-700">{product.aciklama}</div>
              </div>
            )}

            <div className="pt-4 border-t border-neutral-200">
              <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                <div className="flex items-center gap-2">
                  <span className="text-red-600 font-semibold text-sm">⚠</span>
                  <span className="text-sm text-red-800">
                    Bu ürün kritik stok seviyesinin altındadır. (Mevcut: {product.stok}, Kritik: {product.kritik})
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StockProductDetailModal({ product, onClose, canViewPrice }) {
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [selectedIslem, setSelectedIslem] = useState(null);
  const [rafStoklari, setRafStoklari] = useState([]);
  const [loadingRafStok, setLoadingRafStok] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        setLoadingHistory(true);
        const response = await getProductHistoryAPI(product.id, 50);
        
        if (response && response.data) {
          // Response formatını kontrol et
          let islemler = [];
          
          if (response.data.islemler && Array.isArray(response.data.islemler)) {
            islemler = response.data.islemler;
          } else if (Array.isArray(response.data)) {
            islemler = response.data;
          }
          
          // Duplicate'leri filtrele ve stok_hareket tipindeki kayıtları kaldır
          const uniqueIslemler = [];
          const seenIds = new Set();
          
          islemler.forEach((islem) => {
            const islemTipi = islem.IslemTipi || islem.islem_tipi || islem.islemTipi || '';
            
            // stok_hareket tipindeki kayıtları filtrele (sadece Giriş ve Çıkış tiplerini göster)
            if (islemTipi === 'stok_hareket') {
              return; // Bu kaydı atla
            }
            
            const id = islem.Id || islem.id || `${islem.Tarih || islem.tarih}_${islemTipi}_${islem.Miktar || islem.miktar}`;
            if (!seenIds.has(id)) {
              seenIds.add(id);
              uniqueIslemler.push(islem);
            }
          });
          
          setHistory(uniqueIslemler);
        } else {
          setHistory([]);
        }
      } catch (err) {
        if (isDevelopment) {
          console.error('İşlem geçmişi yüklenemedi', err);
        }
        setHistory([]);
      } finally {
        setLoadingHistory(false);
      }
    };
    
    loadHistory();
  }, [product.id]);

  // Ürünün hangi raflarda olduğunu API'den yükle (GET /raflar?urun_id=X)
  useEffect(() => {
    const loadRafStoklari = async () => {
      try {
        setLoadingRafStok(true);
        const productId = product.id || product.Id;
        if (!productId) {
          setRafStoklari([]);
          return;
        }

        const response = await getRafsByUrunIdAPI(productId);
        const raw = response?.data;
        const list = raw?.tum_raflar || raw?.normal || raw?.mal_kabul || raw?.cikis || [];
        const raflarList = Array.isArray(list) ? list : [];

        const rafStokList = raflarList.map((r) => ({
          rafId: r.Id ?? r.raf_id ?? r.id,
          rafKodu: r.RafKodu ?? r.raf_kodu ?? '',
          rafAdi: r.RafAdi ?? r.raf_adi ?? '',
          adet: Number(r.UrunAdet ?? r.urun_adet ?? 0),
        })).filter((r) => r.adet > 0);

        setRafStoklari(rafStokList);
      } catch (err) {
        if (isDevelopment) {
          console.error('Raf stok bilgileri yüklenemedi:', err);
        }
        setRafStoklari([]);
      } finally {
        setLoadingRafStok(false);
      }
    };

    loadRafStoklari();
  }, [product.id, refreshTrigger]);

  // Broadcast channel ile stok girişi tamamlandığında raf stok bilgisini yenile
  useEffect(() => {
    const handleMessage = (message) => {
      if (message.type === 'stock-entry-completed' && message.productId === product.id) {
        setRefreshTrigger(prev => prev + 1);
      }
    };
    
    const cleanup = listenToMessages(handleMessage);
    return cleanup;
  }, [product.id]);

  const getStockStatus = () => {
    if (product.stock < product.criticalStock) {
      return { text: 'Kritik', color: 'red' };
    }
    if (product.stock < product.criticalStock * 1.25) {
      return { text: 'Uyarı', color: 'amber' };
    }
    return { text: 'Normal', color: 'emerald' };
  };
  
  const stockStatus = getStockStatus();
  
  const formatDate = (dateString) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString('tr-TR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  const getIslemIcon = (islemTipi) => {
    if (!islemTipi) return '📋';
    
    const tip = String(islemTipi).toLowerCase();
    
    if (tip === 'giriş' || tip === 'stok_giris' || tip.includes('giriş')) {
      return '📥';
    }
    if (tip === 'çıkış' || tip === 'stok_cikis' || tip.includes('çıkış') || tip.includes('cıkış')) {
      return '📤';
    }
    if (tip === 'urun_ekleme' || tip === 'ürün_ekleme') {
      return '➕';
    }
    if (tip === 'urun_guncelleme' || tip === 'ürün_güncelleme') {
      return '✏️';
    }
    return '📋';
  };
  
  return (
    <div className="fixed inset-0 bg-black/25 flex items-center justify-center px-4 z-50" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white border border-neutral-300 rounded-2xl shadow-lg max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
          <div className="flex items-center justify-between">
            <h3 className="text-base sm:text-lg font-semibold text-neutral-900">Ürün Detayları</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-neutral-600 underline underline-offset-4"
            >
              Kapat
            </button>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Ürün Adı
              </label>
              <div className="text-sm text-neutral-900 font-medium">{product.name || '-'}</div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Ürün Kodu
              </label>
              <div className="text-sm text-neutral-900">{product.code || '-'}</div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Barkod
              </label>
              <div className="text-sm text-neutral-900">{product.barcode || '-'}</div>
            </div>

            {canViewPrice && (
              <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wide text-neutral-600">
                  Fiyat (TL)
                </label>
                <div className="text-sm text-neutral-900 font-medium">
                  {product.price ? `${Number(product.price).toFixed(2)} ₺` : '-'}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wide text-neutral-600">
                  Mevcut Stok
                </label>
                <div className={`text-sm font-semibold ${
                  stockStatus.color === 'red' ? 'text-red-600' :
                  stockStatus.color === 'amber' ? 'text-amber-600' :
                  'text-emerald-600'
                }`}>
                  {product.stock || 0} {product.olcuBirimi || 'adet'}
                </div>
              </div>
              <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wide text-neutral-600">
                  Kritik Stok
                </label>
                <div className="text-sm text-neutral-900 font-semibold">{product.criticalStock || 0}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wide text-neutral-600">
                  Toplam Giriş
                </label>
                <div className="text-sm text-emerald-700 font-medium">+{product.totalIn || 0}</div>
              </div>
              <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wide text-neutral-600">
                  Toplam Çıkış
                </label>
                <div className="text-sm text-red-700 font-medium">-{product.totalOut || 0}</div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Ölçü Birimi
              </label>
              <div className="text-sm text-neutral-900">{product.olcuBirimi || 'adet'}</div>
            </div>

            {/* Raf Stok Bilgileri */}
            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Raf Stok Durumu
              </label>
              {loadingRafStok ? (
                <div className="text-sm text-neutral-500">Yükleniyor...</div>
              ) : rafStoklari.length === 0 ? (
                <div className="text-sm text-neutral-500">Bu ürün hiçbir rafta bulunmuyor</div>
              ) : (
                <div className="space-y-2">
                  {rafStoklari.map((rafStok) => (
                    <div
                      key={rafStok.rafId}
                      className="flex items-center justify-between p-2 rounded-lg bg-neutral-50 border border-neutral-200"
                    >
                      <div className="flex-1">
                        <div className="text-sm font-medium text-neutral-900">{rafStok.rafAdi}</div>
                        <div className="text-xs text-neutral-500">Kod: {rafStok.rafKodu}</div>
                      </div>
                      <div className="text-sm font-semibold text-neutral-900">
                        {rafStok.adet} {product.olcuBirimi || 'adet'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Durum
              </label>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                  product.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-200 text-neutral-600'
                }`}>
                  {product.status === 'active' ? 'Aktif' : 'Pasif'}
                </span>
              </div>
            </div>

            {product.desc && (
              <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wide text-neutral-600">
                  Açıklama
                </label>
                <div className="text-sm text-neutral-700">{product.desc}</div>
              </div>
            )}

            <div className="pt-4 border-t border-neutral-200">
              <div className={`${
                stockStatus.color === 'red' ? 'bg-red-50 border-red-200' :
                stockStatus.color === 'amber' ? 'bg-amber-50 border-amber-200' :
                'bg-emerald-50 border-emerald-200'
              } border rounded-xl p-3`}>
                <div className="flex items-center gap-2">
                  <span className={`${
                    stockStatus.color === 'red' ? 'text-red-600' :
                    stockStatus.color === 'amber' ? 'text-amber-600' :
                    'text-emerald-600'
                  } font-semibold text-sm`}>
                    {stockStatus.color === 'red' ? '⚠' : stockStatus.color === 'amber' ? '⚡' : '✓'}
                  </span>
                  <span className={`text-sm ${
                    stockStatus.color === 'red' ? 'text-red-800' :
                    stockStatus.color === 'amber' ? 'text-amber-800' :
                    'text-emerald-800'
                  }`}>
                    {stockStatus.color === 'red' 
                      ? `Bu ürün kritik stok seviyesinin altındadır. (Mevcut: ${product.stock}, Kritik: ${product.criticalStock})`
                      : stockStatus.color === 'amber'
                      ? `Bu ürün kritik stok seviyesine yaklaşmaktadır. (Mevcut: ${product.stock}, Kritik: ${product.criticalStock})`
                      : `Bu ürünün stok durumu normal seviyededir. (Mevcut: ${product.stock}, Kritik: ${product.criticalStock})`
                    }
                  </span>
                </div>
              </div>
            </div>

            {/* İşlem Geçmişi */}
            <div className="pt-4 border-t border-neutral-200">
              <h4 className="text-sm font-semibold text-neutral-900 mb-3">İşlem Geçmişi</h4>
              {loadingHistory ? (
                <div className="text-center py-6 text-neutral-500 text-sm">
                  Yükleniyor...
                </div>
              ) : history.length === 0 ? (
                <div className="text-center py-6 text-neutral-500 text-sm">
                  Henüz işlem geçmişi bulunmuyor
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {history.map((islem, index) => (
                    <div 
                      key={index} 
                      className="p-3 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors cursor-pointer"
                      onClick={() => setSelectedIslem(islem)}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-lg flex-shrink-0">{getIslemIcon(islem.IslemTipi || islem.islem_tipi || islem.islemTipi)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-neutral-900">
                            {(() => {
                              const islemTipi = islem.IslemTipi || islem.islem_tipi || islem.islemTipi || '';
                              const aciklama = ((islem.Aciklama || islem.aciklama || '')).toLowerCase();
                              const hasGiris = aciklama.includes('(giris') || aciklama.includes('(giriş');
                              const hasCikis = aciklama.includes('(cikis') || aciklama.includes('(çıkış') || aciklama.includes('(cıkış');
                              
                              if (islemTipi === 'Giriş' || islemTipi === 'stok_giris') {
                                return 'Stok Girişi';
                              } else if (islemTipi === 'Çıkış' || islemTipi === 'stok_cikis') {
                                return 'Stok Çıkışı';
                              } else if (islemTipi === 'stok_hareket') {
                                // stok_hareket tipinde açıklamada (giris) veya (cikis) bilgisine bak
                                if (hasGiris) return 'Stok Girişi';
                                if (hasCikis) return 'Stok Çıkışı';
                                return 'Stok Hareketi';
                              } else if (islemTipi === 'urun_ekleme') {
                                return 'Ürün Eklendi';
                              } else if (islemTipi === 'urun_guncelleme') {
                                return 'Ürün Güncellendi';
                              }
                              return islemTipi || 'İşlem';
                            })()}
                          </div>
                          {(() => {
                            // Açıklamayı temizle - "| Not:" kısmından sonrasını al
                            let cleanAciklama = islem.Aciklama || islem.aciklama || '';
                            const notIndex = cleanAciklama.indexOf('| Not:');
                            if (notIndex !== -1) {
                              cleanAciklama = cleanAciklama.substring(notIndex + 6).trim();
                            }
                            // Eğer açıklama "Stok hareketi yapıldı" gibi bir şey içeriyorsa, sadece "Not:" kısmını göster
                            if (cleanAciklama.includes('Stok hareketi yapıldı')) {
                              const notIndex2 = cleanAciklama.indexOf('Not:');
                              if (notIndex2 !== -1) {
                                cleanAciklama = cleanAciklama.substring(notIndex2 + 4).trim();
                              }
                            }
                            
                            return (
                              <>
                                {cleanAciklama && (
                                  <div className="text-xs text-neutral-600 mt-1">
                                    {cleanAciklama}
                                  </div>
                                )}
                                {(islem.Miktar || islem.miktar) && (
                                  <div className="text-xs text-neutral-700 mt-1 font-medium">
                                    Miktar: {islem.Miktar || islem.miktar}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-xs text-neutral-500">
                              {formatDate(islem.Tarih || islem.tarih)}
                            </span>
                            {(islem.kullanici || islem.KullaniciAdSoyad || islem.kullanici_ad_soyad) && (
                              <span className="text-xs text-neutral-600 font-medium">
                                {islem.kullanici?.ad_soyad || islem.kullanici?.adSoyad || islem.KullaniciAdSoyad || islem.kullanici_ad_soyad || '-'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {/* İşlem Detay Modalı */}
              {selectedIslem && (
                <IslemDetailModal
                  islem={selectedIslem}
                  onClose={() => setSelectedIslem(null)}
                  canViewPrice={canViewPrice}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MovementModal({ onClose, item }) {
  const isGiris = item.icon === 'plus';
  const isProductActivity = item.icon === 'plus-box' || item.icon === 'edit' || item.icon === 'status-change';
  
  const getActivityDescription = () => {
    if (item.icon === 'plus-box') return 'Yeni ürün ekleme kaydı';
    if (item.icon === 'edit') return 'Ürün güncelleme kaydı';
    if (item.icon === 'status-change') return 'Ürün durum değişikliği kaydı';
    return isGiris ? 'Depoya giriş kaydı' : 'Depodan çıkış kaydı';
  };
  
  // Type'dan "| Not:" kısmından öncesini al
  const getCleanType = () => {
    if (!item.type) return '';
    const notIndex = item.type.indexOf('| Not:');
    if (notIndex !== -1) {
      return item.type.substring(0, notIndex).trim();
    }
    return item.type;
  };
  
  // Description'dan "Not: " kısmından sonrasını al
  const getCleanDescription = () => {
    if (!item.description) return '';
    const notIndex = item.description.indexOf('Not: ');
    if (notIndex !== -1) {
      return item.description.substring(notIndex + 5).trim();
    }
    // Eğer "Not: " yoksa, "| Not:" formatını kontrol et
    const pipeNotIndex = item.description.indexOf('| Not:');
    if (pipeNotIndex !== -1) {
      return item.description.substring(pipeNotIndex + 6).trim();
    }
    return item.description;
  };
  
  return (
    <div className="fixed inset-0 bg-black/25 flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white border border-neutral-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-base font-semibold text-neutral-900">
            {isProductActivity ? 'Aktivite Detayı' : 'Hareket Detayı'}
          </h4>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-neutral-600 underline underline-offset-4"
          >
            Kapat
          </button>
        </div>
        <div className="space-y-3">
          <div className="text-sm text-neutral-900 font-semibold">{item.name}</div>
          <div className="text-xs text-neutral-600 space-y-1">
            <div>İşlem: {getCleanType()}</div>
            {item.productCode && <div>Ürün Kodu: {item.productCode}</div>}
            {!isProductActivity && <div>Adet: {item.adet || 0}</div>}
            {getCleanDescription() && <div>Açıklama: {getCleanDescription()}</div>}
            <div>Tarih: {item.date} {item.time}</div>
            {item.username && <div>{isProductActivity ? 'Kullanıcı' : 'Ekleyen'}: {item.username}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <SmallIcon name={item.icon} />
          <span className="text-neutral-800">{getActivityDescription()}</span>
        </div>
      </div>
    </div>
  );
}

function IslemDetailModal({ islem, onClose, canViewPrice }) {
  const formatDate = (dateString) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString('tr-TR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  const getIslemTitle = () => {
    const islemTipi = islem.IslemTipi || islem.islem_tipi || islem.islemTipi || '';
    if (islemTipi === 'Giriş' || islemTipi === 'stok_giris') return 'Stok Giriş Detayı';
    if (islemTipi === 'Çıkış' || islemTipi === 'stok_cikis') return 'Stok Çıkış Detayı';
    if (islemTipi === 'urun_ekleme') return 'Ürün Ekleme Detayı';
    if (islemTipi === 'urun_guncelleme') return 'Ürün Güncelleme Detayı';
    if (islemTipi === 'stok_hareket') return 'Stok Hareket Detayı';
    return 'İşlem Detayı';
  };

  const formatIslemTipi = (tip) => {
    if (!tip) return 'İşlem';
    const tipLower = String(tip).toLowerCase();
    if (tipLower === 'giriş' || tipLower === 'stok_giris') return 'Stok Girişi';
    if (tipLower === 'çıkış' || tipLower === 'stok_cikis') return 'Stok Çıkışı';
    if (tipLower === 'urun_ekleme') return 'Ürün Ekleme';
    if (tipLower === 'urun_guncelleme') return 'Ürün Güncelleme';
    if (tipLower === 'stok_hareket') return 'Stok Hareketi';
    return tip;
  };

  const formatAciklama = (aciklama) => {
    if (!aciklama) return '-';
    // "Ürün güncellendi: ad" gibi metinlerde iki noktadan sonrasını al
    const colonIndex = aciklama.indexOf(':');
    if (colonIndex !== -1 && colonIndex < aciklama.length - 1) {
      return aciklama.substring(colonIndex + 1).trim();
    }
    return aciklama;
  };

  const renderDegerFields = (deger, title) => {
    if (!deger) return null;
    
    const adetTuruMap = {
      'adet': 'Adet',
      'metre': 'Metre (m)',
      'milimetre': 'Milimetre (mm)',
      'kilogram': 'Kilogram (kg)',
      'gram': 'Gram (gr)'
    };

    return (
      <div className="space-y-3 bg-neutral-50 rounded-xl p-4 border border-neutral-200">
        <h5 className="text-sm font-semibold text-neutral-900">{title}</h5>
        <div className="grid grid-cols-2 gap-3">
          {deger.UrunKodu !== undefined && (
            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">Ürün Kodu</label>
              <div className="text-sm text-neutral-900">{deger.UrunKodu || '-'}</div>
            </div>
          )}
          {deger.UrunAdi !== undefined && (
            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">Ürün Adı</label>
              <div className="text-sm text-neutral-900">{deger.UrunAdi || '-'}</div>
            </div>
          )}
          {deger.Barkod !== undefined && (
            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">Barkod</label>
              <div className="text-sm text-neutral-900">{deger.Barkod || '-'}</div>
            </div>
          )}
          {canViewPrice && deger.FiyatTL !== undefined && deger.FiyatTL !== null && (
            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">Fiyat (TL)</label>
              <div className="text-sm text-neutral-900 font-medium">{Number(deger.FiyatTL).toFixed(2)} ₺</div>
            </div>
          )}
          {deger.ReelStok !== undefined && (
            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">Mevcut Stok</label>
              <div className="text-sm text-neutral-900 font-semibold">{deger.ReelStok} {adetTuruMap[deger.AdetTuru] || deger.AdetTuru || 'adet'}</div>
            </div>
          )}
          {deger.KritikStok !== undefined && (
            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">Kritik Stok</label>
              <div className="text-sm text-neutral-900">{deger.KritikStok}</div>
            </div>
          )}
          {deger.ToplamGiris !== undefined && (
            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">Toplam Giriş</label>
              <div className="text-sm text-emerald-700 font-medium">+{deger.ToplamGiris}</div>
            </div>
          )}
          {deger.ToplamCikis !== undefined && (
            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">Toplam Çıkış</label>
              <div className="text-sm text-red-700 font-medium">-{deger.ToplamCikis}</div>
            </div>
          )}
          {deger.AdetTuru !== undefined && (
            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">Ölçü Birimi</label>
              <div className="text-sm text-neutral-900">{adetTuruMap[deger.AdetTuru] || deger.AdetTuru}</div>
            </div>
          )}
          {deger.Aktif !== undefined && (
            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">Durum</label>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                  deger.Aktif ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-200 text-neutral-600'
                }`}>
                  {deger.Aktif ? 'Aktif' : 'Pasif'}
                </span>
              </div>
            </div>
          )}
        </div>
        {deger.Aciklama && (
          <div className="space-y-1 col-span-2">
            <label className="block text-xs uppercase tracking-wide text-neutral-600">Açıklama</label>
            <div className="text-sm text-neutral-700">{deger.Aciklama}</div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center px-4 z-[60]" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white border border-neutral-300 rounded-2xl shadow-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base sm:text-lg font-semibold text-neutral-900">{getIslemTitle()}</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-neutral-600 underline underline-offset-4"
            >
              Kapat
            </button>
          </div>

          <div className="space-y-4">
            {/* Genel Bilgiler */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wide text-neutral-600">İşlem Tipi</label>
                <div className="text-sm text-neutral-900 font-medium">{formatIslemTipi(islem.IslemTipi || islem.islem_tipi || islem.islemTipi)}</div>
              </div>
              <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wide text-neutral-600">Tarih</label>
                <div className="text-sm text-neutral-900">{formatDate(islem.Tarih || islem.tarih)}</div>
              </div>
            </div>

            {(islem.Aciklama || islem.aciklama) && (
              <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wide text-neutral-600">Açıklama</label>
                <div className="text-sm text-neutral-900">{formatAciklama(islem.Aciklama || islem.aciklama)}</div>
              </div>
            )}

            {(islem.Miktar || islem.miktar) && (
              <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wide text-neutral-600">Miktar</label>
                <div className="text-sm text-neutral-900 font-semibold">{islem.Miktar || islem.miktar}</div>
              </div>
            )}

            {(islem.kullanici || islem.KullaniciAdSoyad || islem.kullanici_ad_soyad) && (
              <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wide text-neutral-600">İşlemi Yapan</label>
                <div className="text-sm text-neutral-900 font-medium">
                  {islem.kullanici?.ad_soyad || islem.kullanici?.adSoyad || islem.KullaniciAdSoyad || islem.kullanici_ad_soyad || '-'}
                </div>
              </div>
            )}

            {/* Yeni Değer - Sadece varsa göster */}
            {islem.YeniDeger && renderDegerFields(islem.YeniDeger, 'Yeni Değer')}

            {/* Eski Değer - Sadece varsa göster */}
            {islem.EskiDeger && renderDegerFields(islem.EskiDeger, 'Eski Değer')}
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoModal({ onClose }) {
  return (
    <div className="fixed inset-0 bg-black/25 flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white border border-neutral-200 p-5 space-y-4 text-center">
        <h4 className="text-base font-semibold text-neutral-900">Bilgilendirme</h4>
        <p className="text-sm text-neutral-700">Demo sürümünde bu özellik kullanılamıyor.</p>
        <button
          type="button"
          onClick={onClose}
          className="w-full bg-neutral-900 text-white py-2.5 rounded-full text-sm font-semibold hover:bg-neutral-800 transition"
        >
          Tamam
        </button>
      </div>
    </div>
  );
}

function SmallIcon({ name }) {
  const common = 'stroke-current text-neutral-900';
  switch (name) {
    case 'product':
      return (
        <svg className={common} width="20" height="20" fill="none" strokeWidth="1.5">
          <path d="M5 7l5-3 5 3-5 3-5-3Z" />
          <path d="M5 7v6l5 3 5-3V7" />
          <path d="M10 10v6" />
        </svg>
      );
    case 'alert':
      return (
        <svg className={common} width="20" height="20" fill="none" strokeWidth="1.5">
          <path d="M10 3 3 17h14L10 3Z" />
          <path d="M10 8v4M10 14v1" strokeLinecap="round" />
        </svg>
      );
    case 'balance':
      return (
        <svg className={common} width="20" height="20" fill="none" strokeWidth="1.5">
          <path d="M4 9h5L6.5 14 4 9Z" />
          <path d="M11 9h5l-2.5 5L11 9Z" />
          <path d="M10 5v10" strokeLinecap="round" />
          <path d="M7 5h6" strokeLinecap="round" />
        </svg>
      );
    case 'checklist':
      return (
        <svg className={common} width="20" height="20" fill="none" strokeWidth="1.5">
          <path d="M4 6h8M4 10h6M4 14h5" strokeLinecap="round" />
          <path d="m13 6 2 2 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'plus':
      return (
        <svg className={common} width="18" height="18" fill="none" strokeWidth="2" viewBox="0 0 18 18">
          <path d="M9 3v12M3 9h12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'minus':
      return (
        <svg className={common} width="18" height="18" fill="none" strokeWidth="2" viewBox="0 0 18 18">
          <path d="M3 9h12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'plus-box':
      return (
        <svg className={common} width="20" height="20" fill="none" strokeWidth="1.5">
          <rect x="3" y="3" width="14" height="14" rx="2" />
          <path d="M10 6v8M6 10h8" strokeLinecap="round" />
        </svg>
      );
    case 'edit':
      return (
        <svg className={common} width="20" height="20" fill="none" strokeWidth="1.5">
          <path d="M14 3l3 3-9 9H5v-3l9-9z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 5l3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'status-change':
      return (
        <svg className={common} width="20" height="20" fill="none" strokeWidth="1.5">
          <path d="M4 10h12M4 10l3-3M4 10l3 3" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="16" cy="10" r="2" />
        </svg>
      );
    default:
      return null;
  }
}
function MenuIcon({ name }) {
  const common = 'stroke-current text-primary-800 w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12';
  switch (name) {
    case 'arrow-down':
      return (
        <svg className={common} fill="none" strokeWidth="1.5" viewBox="0 0 32 32" preserveAspectRatio="xMidYMid meet">
          <path d="M16 6v20M9 19l7 7 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'dashboard':
      return (
        <svg className={common} fill="none" strokeWidth="1.5" viewBox="0 0 32 32" preserveAspectRatio="xMidYMid meet">
          <rect x="5" y="5" width="9" height="9" rx="1.5" />
          <rect x="18" y="5" width="9" height="5" rx="1.5" />
          <rect x="18" y="12" width="9" height="15" rx="1.5" />
          <rect x="5" y="16" width="9" height="11" rx="1.5" />
        </svg>
      );
    case 'product':
      return (
        <svg className={common} fill="none" strokeWidth="1.5" viewBox="0 0 32 32" preserveAspectRatio="xMidYMid meet">
          <path d="M8 10l8-4 8 4-8 4-8-4Z" />
          <path d="M8 10v10l8 4 8-4V10" />
          <path d="M16 14v10" />
        </svg>
      );
    case 'plus-box':
      return (
        <svg className={common} fill="none" strokeWidth="1.5" viewBox="0 0 32 32" preserveAspectRatio="xMidYMid meet">
          <rect x="6" y="6" width="20" height="20" rx="3" />
          <path d="M16 11v10M11 16h10" strokeLinecap="round" />
        </svg>
      );
    case 'arrows-swap':
      return (
        <svg className={common} fill="none" strokeWidth="1.5" viewBox="0 0 32 32" preserveAspectRatio="xMidYMid meet">
          <path d="M10 9h12M14 5l-4 4 4 4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M22 23H10m8 4 4-4-4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'users':
      return (
        <svg className={common} fill="none" strokeWidth="1.5" viewBox="0 0 32 32" preserveAspectRatio="xMidYMid meet">
          <circle cx="12" cy="12" r="4" />
          <circle cx="21" cy="11" r="3" />
          <path d="M5 24c0-3.5 3-6 7-6s7 2.5 7 6" />
          <path d="M18 19c1.5.2 4 1.2 4 5" />
        </svg>
      );
    case 'list':
      return (
        <svg className={common} fill="none" strokeWidth="1.5" viewBox="0 0 32 32" preserveAspectRatio="xMidYMid meet">
          <path d="M10 10h12M10 16h12M10 22h12" strokeLinecap="round" />
          <circle cx="7" cy="10" r="1.5" />
          <circle cx="7" cy="16" r="1.5" />
          <circle cx="7" cy="22" r="1.5" />
        </svg>
      );
    case 'pin':
      return (
        <svg className={common} fill="none" strokeWidth="1.5" viewBox="0 0 32 32" preserveAspectRatio="xMidYMid meet">
          <path d="M16 25s7-6 7-12a7 7 0 10-14 0c0 6 7 12 7 12z" />
          <circle cx="16" cy="13" r="2.5" />
        </svg>
      );
    default:
      return null;
  }
}

function StockPage({ onBack, aktifFirma, isAdmin, canUpdateStock, canViewPrice }) {
  const [search, setSearch] = useState('');
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [onlyActive, setOnlyActive] = useState(false);
  const [onlyPassive, setOnlyPassive] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState('code');
  const [sortDir, setSortDir] = useState('asc'); // asc | desc
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showAccessDenied, setShowAccessDenied] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState([]);
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [columnOrder, setColumnOrder] = useState(['code', 'name', 'barcode', 'price', 'description', 'totalIn', 'totalOut', 'stock', 'olcuBirimi', 'criticalStock']);
  const [draggedColumn, setDraggedColumn] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showStockEntryModal, setShowStockEntryModal] = useState(false);
  const [stockEntryBarkod, setStockEntryBarkod] = useState('');
  const [stockEntryProduct, setStockEntryProduct] = useState(null);
  const [stockEntryRafBarkodu, setStockEntryRafBarkodu] = useState('');
  const [stockEntryRaf, setStockEntryRaf] = useState(null);
  const [stockEntryAdet, setStockEntryAdet] = useState('');
  const [stockEntryAciklama, setStockEntryAciklama] = useState('');
  const [stockEntryError, setStockEntryError] = useState('');
  const [stockEntrySuccess, setStockEntrySuccess] = useState(false);
  const [stockEntryStep, setStockEntryStep] = useState(1); // 1: Ürün barkodu, 2: Raf barkodu

  // API'den ürünleri yükle
  useEffect(() => {
    const loadProducts = async () => {
      try {
        const response = await getProductsAPI();
        
        let productsArray = null;
        
        // Response formatını kontrol et
        if (Array.isArray(response)) {
          // Direkt array dönüyorsa
          productsArray = response;
        } else if (response && response.data) {
          // { success: true, data: {...} } formatındaysa
          if (Array.isArray(response.data)) {
            // data direkt array ise
            productsArray = response.data;
          } else if (typeof response.data === 'object' && response.data !== null) {
            // data bir obje ise, tüm key'lerini kontrol et
            const keys = Object.keys(response.data);
            // Önce yaygın key'leri kontrol et
            if (response.data.products && Array.isArray(response.data.products)) {
              productsArray = response.data.products;
            } else if (response.data.items && Array.isArray(response.data.items)) {
              productsArray = response.data.items;
            } else if (response.data.data && Array.isArray(response.data.data)) {
              productsArray = response.data.data;
            } else {
              // Tüm değerleri kontrol et, array olan ilk değeri al
              const values = Object.values(response.data);
              const arrayValue = values.find(v => Array.isArray(v) && v.length > 0);
              if (arrayValue) {
                productsArray = arrayValue;
              } else {
                // Eğer hiç array yoksa, tüm değerleri kontrol et (boş array'ler de dahil)
                const anyArray = values.find(v => Array.isArray(v));
                if (anyArray) {
                  productsArray = anyArray;
                }
              }
            }
          }
        }
        
        if (productsArray && productsArray.length > 0) {
          // API'den gelen veriyi frontend formatına çevir
          const formattedProducts = productsArray.map((product) => ({
            id: product.Id || product.id,
            code: product.UrunKodu || product.urun_kodu || '',
            name: product.UrunAdi || product.urun_adi || '',
            barcode: product.Barkod || product.barkod || '',
            criticalStock: product.KritikStok || product.kritik_stok || 0,
            price: product.FiyatTL || product.fiyat_tl || 0,
            stock: product.ReelStok || product.reel_stok || product.stok || 0,
            totalIn: product.ToplamGiris || product.toplam_giris || 0,
            totalOut: product.ToplamCikis || product.toplam_cikis || 0,
            olcuBirimi: product.AdetTuru || product.adet_turu || 'adet',
            status: (product.Aktif !== undefined ? product.Aktif : product.aktif !== undefined ? product.aktif : true) ? 'active' : 'passive',
            desc: product.Aciklama || product.aciklama || '',
          }));
          
          setProducts(formattedProducts);
        } else {
          // Ürün listesi boş veya geçersiz format
          setProducts([]);
        }
      } catch (err) {
        if (isDevelopment) {
          console.error('Ürünler yüklenemedi', err);
        }
        // Hata durumunda boş array göster
        setProducts([]);
      }
    };
    
    loadProducts();
    
    // BroadcastChannel ile tüm tab/window'lardan güncellemeleri dinle
    const handleDataUpdate = (message) => {
      if (message.type === 'stock-movement' || message.type === 'product-added' || message.type === 'product-updated' || message.type === 'data-updated') {
        loadProducts();
      }
    };
    const cleanup = listenToMessages(handleDataUpdate);
    
    // Farklı cihazlardan gelen güncellemeler için polling (her 5 saniyede bir)
    let intervalId = null;
    
    const startPolling = () => {
      // Sayfa görünürse polling başlat
      if (document.visibilityState === 'visible') {
        intervalId = setInterval(() => {
          loadProducts();
        }, 5000); // 5 saniyede bir
      }
    };
    
    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    
    // Sayfa görünürlük değişikliklerini dinle
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Sayfa görünür olduğunda hemen veri çek ve polling başlat
        loadProducts();
        startPolling();
      } else {
        // Sayfa gizlendiğinde polling'i durdur
        stopPolling();
      }
    };
    
    // İlk yüklemede polling başlat
    startPolling();
    
    // Sayfa görünürlük değişikliklerini dinle
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      cleanup();
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Aktif filtre sayısı
  const activeFilterCount = [onlyCritical, onlyActive, onlyPassive].filter(Boolean).length;

  const filtered = products.filter((p) => {
    const term = search.toLowerCase();
    const matches =
      p.name.toLowerCase().includes(term) ||
      p.code.toLowerCase().includes(term) ||
      p.barcode.toLowerCase().includes(term) ||
      (p.desc || '').toLowerCase().includes(term);
    const criticalOk = onlyCritical ? p.stock < p.criticalStock : true;
    const activeOk = onlyActive ? (p.status === 'active' || !p.status) : true;
    const passiveOk = onlyPassive ? p.status === 'passive' : true;
    
    // Eğer hem aktif hem pasif seçiliyse hepsini göster
    const statusOk = (onlyActive && onlyPassive) ? true : (activeOk && passiveOk);
    
    return matches && criticalOk && statusOk;
  });

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const val = (key, obj) =>
      key === 'name' || key === 'code' || key === 'barcode' || key === 'description'
        ? (obj[key] || '').toLowerCase()
        : Number(obj[key]);
    const av = val(sortBy, a);
    const bv = val(sortBy, b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  // Sayfalama hesaplamaları
  const totalPages = Math.ceil(sorted.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedItems = sorted.slice(startIndex, endIndex);

  // Filtre veya arama değiştiğinde sayfayı sıfırla
  useEffect(() => {
    setCurrentPage(1);
  }, [search, onlyCritical, onlyActive, onlyPassive, sorted.length]);

  const toggleSort = (key) => {
    if (sortBy === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  const getStockTone = (p) => {
    if (p.stock < p.criticalStock) return 'critical';
    if (p.stock < p.criticalStock * 1.25) return 'warning';
    return 'ok';
  };

  const toggleColumnVisibility = (columnKey) => {
    if (hiddenColumns.includes(columnKey)) {
      const newHidden = hiddenColumns.filter(key => key !== columnKey);
      setHiddenColumns(newHidden);
    } else {
      const newHidden = [...hiddenColumns, columnKey];
      setHiddenColumns(newHidden);
    }
  };

  // Stok girişi fonksiyonları
  const handleOpenStockEntry = () => {
    setShowStockEntryModal(true);
    setStockEntryStep(1);
    setStockEntryBarkod('');
    setStockEntryProduct(null);
    setStockEntryRafBarkodu('');
    setStockEntryAdet('');
    setStockEntryAciklama('');
    setStockEntryError('');
    setStockEntrySuccess(false);
  };

  const handleCloseStockEntry = () => {
    setShowStockEntryModal(false);
    setStockEntryStep(1);
    setStockEntryBarkod('');
    setStockEntryProduct(null);
    setStockEntryRafBarkodu('');
    setStockEntryRaf(null);
    setStockEntryAdet('');
    setStockEntryAciklama('');
    setStockEntryError('');
    setStockEntrySuccess(false);
  };

  // Raf tipi etiket ve renk fonksiyonları
  const getRafTipiLabel = (tipi) => {
    const tipMap = {
      NORMAL: 'Normal Raf',
      MAL_KABUL: 'Mal Kabul',
      CIKIS: 'Çıkış',
    };
    return tipMap[tipi] || tipi;
  };

  const getRafTipiColor = (tipi) => {
    const colorMap = {
      NORMAL: 'bg-neutral-100 text-neutral-700',
      MAL_KABUL: 'bg-yellow-100 text-yellow-700',
      CIKIS: 'bg-red-100 text-red-700',
    };
    return colorMap[tipi] || 'bg-neutral-100 text-neutral-700';
  };

  // Ürün barkodu kontrolü
  useEffect(() => {
    if (stockEntryBarkod.trim().length >= 6 && stockEntryStep === 1) {
      const fetchProduct = async () => {
        try {
          const response = await getProductByBarcodeAPI(stockEntryBarkod.trim());
          if (response.success && response.data) {
            const productData = response.data;
            const product = {
              id: productData.urun_id,
              code: productData.urun_kodu,
              name: productData.urun_adi,
              barcode: productData.barkod,
            };
            setStockEntryProduct(product);
            setStockEntryError('');
          } else {
            setStockEntryProduct(null);
            setStockEntryError('Bu barkoda ait ürün bulunamadı');
          }
        } catch (err) {
          setStockEntryProduct(null);
          setStockEntryError('Ürün bilgisi alınamadı');
        }
      };
      
      const timeoutId = setTimeout(() => {
        fetchProduct();
      }, 300);
      
      return () => clearTimeout(timeoutId);
    } else if (stockEntryBarkod.trim().length < 6 && stockEntryStep === 1) {
      setStockEntryProduct(null);
      setStockEntryError('');
    }
  }, [stockEntryBarkod, stockEntryStep]);

  // Raf barkodu kontrolü
  useEffect(() => {
    if (stockEntryRafBarkodu.trim().length >= 3 && stockEntryStep === 2) {
      const fetchRaf = async () => {
        try {
          const response = await getRafsAPI();
          if (response.success && response.data && response.data.tum_raflar) {
            const raf = response.data.tum_raflar.find(
              (r) => r.RafKodu && r.RafKodu.trim().toLowerCase() === stockEntryRafBarkodu.trim().toLowerCase()
            );
            if (raf) {
              setStockEntryRaf(raf);
              setStockEntryError('');
            } else {
              setStockEntryRaf(null);
              setStockEntryError('');
            }
          } else {
            setStockEntryRaf(null);
          }
        } catch (err) {
          setStockEntryRaf(null);
        }
      };
      
      const timeoutId = setTimeout(() => {
        fetchRaf();
      }, 300);
      
      return () => clearTimeout(timeoutId);
    } else if (stockEntryRafBarkodu.trim().length < 3 && stockEntryStep === 2) {
      setStockEntryRaf(null);
      setStockEntryError('');
    }
  }, [stockEntryRafBarkodu, stockEntryStep]);

  const handleConfirmProduct = () => {
    if (stockEntryProduct) {
      setStockEntryStep(2);
      setStockEntryError('');
    }
  };

  const handleSubmitStockEntry = async () => {
    setStockEntryError('');
    
    if (!stockEntryProduct) {
      setStockEntryError('Lütfen geçerli bir ürün seçin');
      return;
    }
    
    if (!stockEntryRafBarkodu.trim()) {
      setStockEntryError('Raf barkodu zorunludur');
      return;
    }
    
    if (!stockEntryAdet || Number(stockEntryAdet) <= 0) {
      setStockEntryError('Miktar 0\'dan büyük olmalıdır');
      return;
    }

    try {
      const response = await addStockEntryV2(
        stockEntryProduct.barcode,
        stockEntryRafBarkodu.trim(),
        stockEntryAdet,
        stockEntryAciklama.trim()
      );

      if (response.success) {
        setStockEntrySuccess(true);
        setStockEntryError('');
        
        // Raf stok bilgisini yenilemek için trigger'ı artır
        stockEntryRefreshTrigger++;
        broadcastMessage({ type: 'stock-entry-completed', productId: stockEntryProduct.id });
        
        // Formu temizle
        setTimeout(() => {
          handleCloseStockEntry();
          // Ürünleri yeniden yükle
          const loadProducts = async () => {
            try {
              const response = await getProductsAPI();
              if (response.success && response.data) {
                const productsArray = response.data.urunler || response.data || [];
                if (productsArray && productsArray.length > 0) {
                  const formattedProducts = productsArray.map((product) => ({
                    id: product.Id || product.id,
                    code: product.UrunKodu || product.urun_kodu || '',
                    name: product.UrunAdi || product.urun_adi || '',
                    barcode: product.Barkod || product.barkod || '',
                    criticalStock: product.KritikStok || product.kritik_stok || 0,
                    price: product.FiyatTL || product.fiyat_tl || 0,
                    stock: product.ReelStok || product.reel_stok || product.stok || 0,
                    totalIn: product.ToplamGiris || product.toplam_giris || 0,
                    totalOut: product.ToplamCikis || product.toplam_cikis || 0,
                    olcuBirimi: product.AdetTuru || product.adet_turu || 'adet',
                    status: (product.Aktif !== undefined ? product.Aktif : product.aktif !== undefined ? product.aktif : true) ? 'active' : 'passive',
                    desc: product.Aciklama || product.aciklama || '',
                  }));
                  setProducts(formattedProducts);
                  
                  // Seçili ürünü de güncelle
                  if (selectedProduct) {
                    const updatedSelectedProduct = formattedProducts.find(p => p.id === selectedProduct.id);
                    if (updatedSelectedProduct) {
                      setSelectedProduct(updatedSelectedProduct);
                    }
                  }
                }
              }
            } catch (err) {
              console.error('Ürünler güncellenemedi', err);
            }
          };
          loadProducts();
        }, 2000);
      } else {
        setStockEntryError(response.message || 'Stok girişi yapılamadı. Lütfen tekrar deneyin.');
      }
    } catch (err) {
      setStockEntryError(err.message || 'Stok girişi yapılamadı. Lütfen tekrar deneyin.');
    }
  };

  const allColumns = [
    { key: 'code', label: 'Ürün Kodu', align: 'left' },
    { key: 'name', label: 'Ürün Adı', align: 'left' },
    { key: 'barcode', label: 'Barkod', align: 'left' },
    ...(canViewPrice ? [{ key: 'price', label: 'Fiyat (TL)', align: 'right' }] : []),
    { key: 'description', label: 'Açıklama', align: 'left' },
    { key: 'totalIn', label: 'Giriş', align: 'right' },
    { key: 'totalOut', label: 'Çıkış', align: 'right' },
    { key: 'stock', label: 'Stok', align: 'right' },
    { key: 'olcuBirimi', label: 'Ölçü Birimi', align: 'left' },
    { key: 'criticalStock', label: 'Kritik', align: 'right' },
  ];

  // Kolon sırasına göre sırala ve gizli olanları filtrele
  const visibleColumns = columnOrder
    .map((key) => allColumns.find((col) => col.key === key))
    .filter((col) => col && !hiddenColumns.includes(col.key));

  const handleDragStart = (e, columnKey) => {
    setDraggedColumn(columnKey);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', columnKey);
  };

  const handleDragOver = (e, columnKey) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedColumn && draggedColumn !== columnKey) {
      setDragOverColumn(columnKey);
    }
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e, targetColumnKey) => {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetColumnKey) {
      setDraggedColumn(null);
      setDragOverColumn(null);
      return;
    }

    const newOrder = [...columnOrder];
    const draggedIndex = newOrder.indexOf(draggedColumn);
    const targetIndex = newOrder.indexOf(targetColumnKey);

    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedColumn);

    setColumnOrder(newOrder);
    setDraggedColumn(null);
    setDragOverColumn(null);
  };

  const handleDragEnd = () => {
    setDraggedColumn(null);
    setDragOverColumn(null);
  };

  return (
    <section className="space-y-5" aria-label="Stok durumu">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-900">Stok Durumu</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-neutral-700 underline underline-offset-4"
          >
            Menüye dön
          </button>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ürün kodu / ad / barkod ara"
          className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-800 focus:border-neutral-800"
        />
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <span>Filtreler</span>
              {activeFilterCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setOnlyCritical(false);
                  setOnlyActive(false);
                  setOnlyPassive(false);
                }}
                className="text-xs text-neutral-600 hover:text-neutral-900 underline underline-offset-2"
              >
                Temizle
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowColumnSelector(true)}
            className="text-xs sm:text-sm text-neutral-700 underline underline-offset-4 hover:text-neutral-900"
          >
            Gizlemek istenilen kolonlar
          </button>
        </div>
        
        {showFilters && (
          <div className="pt-3 border-t border-neutral-200 space-y-2">
            <label className="inline-flex items-center gap-2 text-sm text-neutral-800 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyCritical}
                onChange={(e) => setOnlyCritical(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-2 focus:ring-neutral-800 focus:ring-offset-0"
              />
              <span>Sadece kritik</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-neutral-800 cursor-pointer ml-4">
              <input
                type="checkbox"
                checked={onlyActive}
                onChange={(e) => setOnlyActive(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-2 focus:ring-neutral-800 focus:ring-offset-0"
              />
              <span>Sadece aktifler</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-neutral-800 cursor-pointer ml-4">
              <input
                type="checkbox"
                checked={onlyPassive}
                onChange={(e) => setOnlyPassive(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-2 focus:ring-neutral-800 focus:ring-offset-0"
              />
              <span>Sadece pasifler</span>
            </label>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-neutral-300 bg-white overflow-x-auto relative">
        <table className="min-w-full text-sm text-neutral-800 border-collapse">
          <thead className="sticky top-0 bg-white border-b-2 border-neutral-300 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              {visibleColumns.map((col, idx) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 ${col.align === 'right' ? 'text-right' : 'text-left'} cursor-move border-r border-neutral-300 ${
                    idx === visibleColumns.length - 1 ? 'border-r-0' : ''
                  } ${
                    draggedColumn === col.key ? 'opacity-50' : ''
                  } ${dragOverColumn === col.key ? 'border-l-2 border-l-neutral-900' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, col.key)}
                  onDragOver={(e) => handleDragOver(e, col.key)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, col.key)}
                  onDragEnd={handleDragEnd}
                >
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSort(col.key);
                      }}
                      className="inline-flex items-center gap-1 text-neutral-600 hover:text-neutral-900"
                      draggable={false}
                    >
                      <span>{col.label}</span>
                      <span className="text-[10px] font-semibold">
                        {sortBy === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedItems.map((p, idx) => {
              const tone = getStockTone(p);
              const handleRowClick = () => {
                setSelectedProduct(p);
              };
              const isPassive = p.status === 'passive';
              const isSelected = selectedProduct && selectedProduct.id === p.id;
              return (
                <tr
                  key={p.id}
                  onClick={handleRowClick}
                  className={`hover:bg-neutral-100 cursor-pointer ${
                    isPassive ? 'opacity-50 bg-neutral-100' : ''
                  } ${
                    isSelected ? 'bg-blue-100' : !isPassive && tone === 'critical'
                      ? 'bg-red-100'
                    : !isPassive && tone === 'warning'
                      ? 'bg-amber-100'
                    : !isPassive && idx % 2 === 1
                      ? 'bg-neutral-50'
                      : ''
                  }`}
                >
                  {visibleColumns.map((col, colIdx) => {
                    const baseClasses = `px-4 py-3 border-r border-neutral-300 ${
                      colIdx === visibleColumns.length - 1 ? 'border-r-0' : ''
                    }`;
                    
                    if (col.key === 'code') {
                      return (
                        <td key={col.key} className={`${baseClasses} text-left font-semibold text-neutral-900`}>
                          {p.code}
                        </td>
                      );
                    }
                    if (col.key === 'name') {
                      return (
                        <td key={col.key} className={`${baseClasses} text-left`}>
                          <div className="flex items-center gap-2">
                            <span>{p.name}</span>
                            {p.status === 'passive' && (
                              <span className="px-2 py-0.5 rounded-full bg-neutral-200 text-neutral-600 text-xs font-semibold">
                                Pasif
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    }
                    if (col.key === 'barcode') {
                      return (
                        <td key={col.key} className={`${baseClasses} text-left text-neutral-600`}>
                          {p.barcode}
                        </td>
                      );
                    }
                    if (col.key === 'price') {
                      return (
                        <td key={col.key} className={`${baseClasses} text-right font-medium text-neutral-900 whitespace-nowrap min-w-[120px]`}>
                          {p.price ? `${Number(p.price).toFixed(2)} ₺` : '-'}
                        </td>
                      );
                    }
                    if (col.key === 'description') {
                      return (
                        <td key={col.key} className={`${baseClasses} text-left text-neutral-600`}>
                          {p.desc || '-'}
                        </td>
                      );
                    }
                    if (col.key === 'totalIn') {
                      return (
                        <td key={col.key} className={`${baseClasses} text-right`}>
                          {p.totalIn}
                        </td>
                      );
                    }
                    if (col.key === 'totalOut') {
                      return (
                        <td key={col.key} className={`${baseClasses} text-right`}>
                          {p.totalOut}
                        </td>
                      );
                    }
                    if (col.key === 'stock') {
                      return (
                        <td
                          key={col.key}
                          className={`${baseClasses} text-right font-semibold ${
                            tone === 'critical'
                              ? 'text-red-600'
                              : tone === 'warning'
                              ? 'text-amber-600'
                              : 'text-emerald-600'
                          }`}
                        >
                          {p.stock}
                        </td>
                      );
                    }
                    if (col.key === 'olcuBirimi') {
                      return (
                        <td key={col.key} className={`${baseClasses} text-left text-neutral-700`}>
                          {p.olcuBirimi || 'adet'}
                        </td>
                      );
                    }
                    if (col.key === 'criticalStock') {
                      return (
                        <td key={col.key} className={`${baseClasses} text-right text-neutral-700 flex items-center justify-end gap-2`}>
                          <span>{p.criticalStock}</span>
                        </td>
                      );
                    }
                    return null;
                  })}
                </tr>
              );
            })}
            {products.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="px-4 py-6 text-center text-neutral-600">
                  Henüz ürün eklenmemiş. Ürün eklemek için menüden "Ürün Ekle" seçeneğini kullanın.
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="px-4 py-6 text-center text-neutral-600">
                  Sonuç bulunamadı
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Sayfalama */}
      {sorted.length > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          itemsPerPage={itemsPerPage}
          totalItems={sorted.length}
          onPageChange={setCurrentPage}
          onItemsPerPageChange={(value) => {
            setItemsPerPage(value);
            setCurrentPage(1);
          }}
        />
      )}

      {showAccessDenied && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
          <div className="rounded-xl bg-red-50 border border-red-200 px-6 py-3 text-sm text-red-800 shadow-lg">
            ⚠️ Ürün düzenleme yetkiniz bulunmamaktadır
          </div>
        </div>
      )}

      {/* Seçili ürün için alt panel */}
      {selectedProduct && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-neutral-300 shadow-2xl z-40 animate-slide-up">
          <div className="max-w-5xl mx-auto px-3 py-3 sm:px-4 sm:py-4">
            <div className="flex items-center justify-between gap-2">
              {/* Mobilde gizli, desktop'ta görünür ürün bilgisi */}
              <div className="hidden lg:flex flex-1 min-w-0">
                <div>
                  <div className="text-sm font-semibold text-neutral-900 truncate">
                    {selectedProduct.name}
                  </div>
                  <div className="text-xs text-neutral-600 mt-0.5">
                    Kod: {selectedProduct.code} • Stok: {selectedProduct.stock} {selectedProduct.olcuBirimi}
                  </div>
                </div>
              </div>
              
              {/* Butonlar - mobilde tam genişlik */}
              <div className="flex items-center gap-1.5 sm:gap-2 flex-1 lg:flex-initial">
                <button
                  type="button"
                  onClick={() => setShowDetailModal(true)}
                  className="flex-1 lg:flex-initial px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-neutral-100 border border-neutral-300 text-neutral-900 text-xs sm:text-sm font-semibold hover:bg-neutral-200 transition-colors whitespace-nowrap"
                >
                  <span className="hidden sm:inline">📋 Ürün Detaylarına Bak</span>
                  <span className="sm:hidden">📋 Detay</span>
                </button>
                {canUpdateStock && (
                  <button
                    type="button"
                    onClick={() => setShowEditModal(true)}
                    className="flex-1 lg:flex-initial px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-neutral-900 text-white text-xs sm:text-sm font-semibold hover:bg-neutral-800 transition-colors whitespace-nowrap"
                  >
                    <span className="hidden sm:inline">✏️ Ürünü Düzenle</span>
                    <span className="sm:hidden">✏️ Düzenle</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProduct(null);
                    setShowEditModal(false);
                    setShowDetailModal(false);
                  }}
                  className="p-2 rounded-lg hover:bg-neutral-100 transition-colors flex-shrink-0"
                  title="Kapat"
                >
                  <svg className="w-4 h-4 sm:w-5 sm:h-5 text-neutral-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEditModal && selectedProduct && canUpdateStock && (
        <ProductEditModal
          product={selectedProduct}
          onClose={() => {
            setShowEditModal(false);
            setSelectedProduct(null);
          }}
          aktifFirma={aktifFirma}
          canViewPrice={canViewPrice}
          onUpdate={async () => {
            // API'den güncel ürün listesini çek
            try {
              const response = await getProductsAPI();
              let productsArray = null;
              
              if (Array.isArray(response)) {
                productsArray = response;
              } else if (response && response.data) {
                if (Array.isArray(response.data)) {
                  productsArray = response.data;
                } else if (response.data.products && Array.isArray(response.data.products)) {
                  productsArray = response.data.products;
                } else if (response.data.items && Array.isArray(response.data.items)) {
                  productsArray = response.data.items;
                } else if (typeof response.data === 'object') {
                  const values = Object.values(response.data);
                  const arrayValue = values.find(v => Array.isArray(v));
                  if (arrayValue) {
                    productsArray = arrayValue;
                  }
                }
              }
              
              if (productsArray && productsArray.length > 0) {
                const formattedProducts = productsArray.map((product) => ({
                  id: product.Id || product.id,
                  code: product.UrunKodu || product.urun_kodu || '',
                  name: product.UrunAdi || product.urun_adi || '',
                  barcode: product.Barkod || product.barkod || '',
                  criticalStock: product.KritikStok || product.kritik_stok || 0,
                  price: product.FiyatTL || product.fiyat_tl || 0,
                  stock: product.ReelStok || product.reel_stok || product.stok || 0,
                  totalIn: product.ToplamGiris || product.toplam_giris || 0,
                  totalOut: product.ToplamCikis || product.toplam_cikis || 0,
                  olcuBirimi: product.AdetTuru || product.adet_turu || 'adet',
                  status: (product.Aktif !== undefined ? product.Aktif : product.aktif !== undefined ? product.aktif : true) ? 'active' : 'passive',
                  desc: product.Aciklama || product.aciklama || '',
                }));
                setProducts(formattedProducts);
                
                // Seçili ürünü de güncelle (alttaki panel için)
                if (selectedProduct) {
                  const updatedSelectedProduct = formattedProducts.find(p => p.id === selectedProduct.id);
                  if (updatedSelectedProduct) {
                    setSelectedProduct(updatedSelectedProduct);
                  }
                }
              }
            } catch (err) {
              if (isDevelopment) {
                console.error('Ürünler güncellenemedi', err);
              }
            }
          }}
        />
      )}

      {showDetailModal && selectedProduct && (
        <StockProductDetailModal
          product={selectedProduct}
          onClose={() => setShowDetailModal(false)}
          canViewPrice={canViewPrice}
        />
      )}

      {/* Stok Girişi Modal */}
      {showStockEntryModal && (
        <div className="fixed inset-0 bg-black/25 flex items-center justify-center px-4 z-50">
          <div className="w-full max-w-md bg-white border border-neutral-300 rounded-2xl shadow-lg max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex-shrink-0 p-4 sm:p-6 border-b border-neutral-200">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base sm:text-lg font-semibold text-neutral-900">
                  Stok Girişi
                </h3>
                <button
                  type="button"
                  onClick={handleCloseStockEntry}
                  className="text-xs sm:text-sm text-neutral-600 underline underline-offset-4 flex-shrink-0"
                >
                  Kapat
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0">
              <div className="space-y-4">
                {stockEntryStep === 1 ? (
                  <>
                    <div className="space-y-1">
                      <label className="block text-xs uppercase tracking-wide text-neutral-600">
                        Ürün Barkodu *
                      </label>
                      <input
                        type="text"
                        value={stockEntryBarkod}
                        onChange={(e) => {
                          try {
                            setStockEntryBarkod(e.target.value);
                          } catch (err) {
                            // Extension hatalarını sessizce geç
                          }
                        }}
                        onFocus={(e) => {
                          try {
                            e.target.select();
                          } catch (err) {
                            // Extension hatalarını sessizce geç
                          }
                        }}
                        placeholder="Ürün barkodunu okutun veya girin"
                        className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
                        autoFocus
                        autoComplete="off"
                      />
                    </div>

                    {stockEntryProduct && (
                      <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm">
                        <div className="font-semibold text-emerald-900">{stockEntryProduct.name}</div>
                        <div className="text-xs text-emerald-700">Kod: {stockEntryProduct.code}</div>
                      </div>
                    )}

                    {stockEntryError && !stockEntryProduct && (
                      <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
                        {stockEntryError}
                      </div>
                    )}

                    {stockEntryProduct && (
                      <div className="flex items-center gap-3 pt-2">
                        <button
                          type="button"
                          onClick={handleCloseStockEntry}
                          className="flex-1 rounded-full border border-neutral-300 text-neutral-700 py-2.5 sm:py-3 text-sm sm:text-base font-semibold hover:bg-neutral-50 transition-colors"
                        >
                          İptal
                        </button>
                        <button
                          type="button"
                          onClick={handleConfirmProduct}
                          className="flex-1 rounded-full bg-neutral-900 text-white py-2.5 sm:py-3 text-sm sm:text-base font-semibold hover:bg-neutral-800 transition-colors"
                        >
                          Devam Et
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="space-y-1">
                      <label className="block text-xs uppercase tracking-wide text-neutral-600">
                        Ürün
                      </label>
                      <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-3 py-2 text-sm">
                        <div className="font-semibold text-neutral-900">{stockEntryProduct.name}</div>
                        <div className="text-xs text-neutral-600">Kod: {stockEntryProduct.code}</div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs uppercase tracking-wide text-neutral-600">
                        Raf Barkodu *
                      </label>
                      <input
                        type="text"
                        value={stockEntryRafBarkodu}
                        onChange={(e) => {
                          try {
                            setStockEntryRafBarkodu(e.target.value);
                          } catch (err) {
                            // Extension hatalarını sessizce geç
                          }
                        }}
                        onFocus={(e) => {
                          try {
                            e.target.select();
                          } catch (err) {
                            // Extension hatalarını sessizce geç
                          }
                        }}
                        placeholder="Raf barkodunu okutun veya girin"
                        className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
                        autoFocus
                        autoComplete="off"
                      />
                    </div>

                    {stockEntryRaf && (
                      <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between mb-1">
                          <div className="font-semibold text-emerald-900">{stockEntryRaf.RafAdi}</div>
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${getRafTipiColor(stockEntryRaf.RafTipi)}`}>
                            {getRafTipiLabel(stockEntryRaf.RafTipi)}
                          </span>
                        </div>
                        <div className="text-xs text-emerald-700">Kod: {stockEntryRaf.RafKodu}</div>
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="block text-xs uppercase tracking-wide text-neutral-600">
                        Miktar *
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={stockEntryAdet}
                        onChange={(e) => {
                          try {
                            const val = e.target.value;
                            if (val === '' || /^\d+$/.test(val)) {
                              setStockEntryAdet(val);
                            }
                          } catch (err) {
                            // Extension hatalarını sessizce geç
                          }
                        }}
                        onFocus={(e) => {
                          try {
                            e.target.select();
                          } catch (err) {
                            // Extension hatalarını sessizce geç
                          }
                        }}
                        placeholder="0"
                        className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900 text-center [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
                        autoComplete="off"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs uppercase tracking-wide text-neutral-600">
                        Açıklama
                      </label>
                      <textarea
                        value={stockEntryAciklama}
                        onChange={(e) => setStockEntryAciklama(e.target.value)}
                        rows={3}
                        placeholder="Not ekleyin"
                        className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
                      />
                    </div>

                    {stockEntryError && (
                      <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
                        {stockEntryError}
                      </div>
                    )}

                    {stockEntrySuccess && (
                      <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
                        ✓ Stok girişi başarıyla yapıldı
                      </div>
                    )}

                    <div className="flex items-center gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setStockEntryStep(1);
                          setStockEntryRafBarkodu('');
                          setStockEntryRaf(null);
                          setStockEntryAdet('');
                          setStockEntryAciklama('');
                          setStockEntryError('');
                        }}
                        className="flex-1 rounded-full border border-neutral-300 text-neutral-700 py-2.5 sm:py-3 text-sm sm:text-base font-semibold hover:bg-neutral-50 transition-colors"
                      >
                        Geri
                      </button>
                      <button
                        type="button"
                        onClick={handleSubmitStockEntry}
                        disabled={stockEntrySuccess}
                        className={`flex-1 rounded-full py-2.5 sm:py-3 text-sm sm:text-base font-semibold transition-colors ${
                          stockEntrySuccess
                            ? 'bg-neutral-200 text-neutral-500 cursor-not-allowed'
                            : 'bg-neutral-900 text-white hover:bg-neutral-800'
                        }`}
                      >
                        Kaydet
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showColumnSelector && (
        <div className="fixed inset-0 bg-black/25 flex items-center justify-center px-4 z-50" onClick={() => setShowColumnSelector(false)}>
          <div className="w-full max-w-sm bg-white border border-neutral-300 rounded-2xl shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base sm:text-lg font-semibold text-neutral-900">Gizlemek İstenilen Kolonlar</h3>
                <button
                  type="button"
                  onClick={() => setShowColumnSelector(false)}
                  className="text-sm text-neutral-600 underline underline-offset-4"
                >
                  Kapat
                </button>
              </div>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {allColumns.map((col) => {
                  const isHidden = hiddenColumns.includes(col.key);
                  return (
                    <label
                      key={col.key}
                      className="flex items-center gap-3 p-3 rounded-lg border border-neutral-200 hover:bg-neutral-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isHidden}
                        onChange={() => toggleColumnVisibility(col.key)}
                        className="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-2 focus:ring-neutral-800 focus:ring-offset-0"
                      />
                      <span className="text-sm text-neutral-900 flex-1">{col.label}</span>
                      {isHidden && (
                        <span className="text-xs text-neutral-500">Gizli</span>
                      )}
                    </label>
                  );
                })}
              </div>
              <div className="mt-4 pt-4 border-t border-neutral-200">
                <button
                  type="button"
                  onClick={() => {
                    setHiddenColumns([]);
                    localStorage.removeItem('abware-hidden-columns');
                  }}
                  className="w-full text-sm text-neutral-700 underline underline-offset-4 hover:text-neutral-900"
                >
                  Tüm kolonları göster
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </section>
  );
}

function ProductEditModal({ product, onClose, aktifFirma, onUpdate, canViewPrice }) {
  const [formData, setFormData] = useState({
    code: product.code,
    name: product.name,
    barcode: product.barcode,
    critical: product.criticalStock.toString(),
    price: product.price ? product.price.toString() : '0',
    desc: product.desc || '',
    status: product.status || 'active',
    olcuBirimi: product.olcuBirimi || 'adet',
  });
  const [errors, setErrors] = useState({});
  const [success, setSuccess] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [devices, setDevices] = useState([]);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [scanError, setScanError] = useState('');
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const controlsRef = useRef(null);
  const oldStatus = product.status || 'active'; // Eski durumu sakla

  // Kamera tarama fonksiyonları
  useEffect(() => {
    if (cameraEnabled) {
      startScan();
    } else {
      stopScan();
    }
    return () => stopScan();
  }, [cameraEnabled, deviceIndex]);

  const startScan = async () => {
    setScanError('');
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;
      const videoInputDevices = await BrowserMultiFormatReader.listVideoInputDevices();
      setDevices(videoInputDevices);
      // İlk açılışta arka kamerayı kullanmak için deviceId belirtmeden sadece facingMode kullan
      const videoConstraints = deviceIndex === 0 
        ? { facingMode: 'environment' }
        : { deviceId: videoInputDevices?.[deviceIndex]?.deviceId };
      const controls = await reader.decodeFromConstraints(
        {
          video: videoConstraints,
        },
        videoRef.current,
        (result, err) => {
          if (result) {
            const text = result.getText();
            setFormData((prev) => ({ ...prev, barcode: text }));
            setCameraEnabled(false);
          }
          if (err && err.name !== 'NotFoundException') {
            setScanError('Okuma hatası');
          }
        }
      );
      controlsRef.current = controls;
    } catch (err) {
      if (isDevelopment) {
        console.error(err);
      }
      setScanError('Kamera açılamadı');
      setCameraEnabled(false);
    }
  };

  const stopScan = () => {
    if (videoRef.current?.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks?.() || [];
      tracks.forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    controlsRef.current?.stop?.();
    controlsRef.current = null;
    if (readerRef.current?.reset) readerRef.current.reset();
    readerRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const openCamera = () => setCameraEnabled(true);
  const closeCamera = () => setCameraEnabled(false);
  const switchCamera = () => {
    if (!devices.length) return;
    const next = (deviceIndex + 1) % devices.length;
    setDeviceIndex(next);
    setCameraEnabled(false);
    setTimeout(() => setCameraEnabled(true), 50);
  };

  const validate = () => {
    const next = {};
    if (!formData.code.trim()) next.code = 'Bu alan zorunlu';
    else if (isCodeExists(formData.code, product.id, aktifFirma)) next.code = 'Bu ürün kodu zaten kullanılıyor';
    
    if (!formData.name.trim()) next.name = 'Bu alan zorunlu';
    
    if (!formData.barcode.trim()) next.barcode = 'Bu alan zorunlu';
    else if (isBarcodeExists(formData.barcode, product.id, aktifFirma)) next.barcode = 'Bu barkod zaten kullanılıyor';
    
    if (!formData.critical.trim()) next.critical = 'Bu alan zorunlu';
    else if (Number(formData.critical) < 0) next.critical = 'Kritik stok 0 veya pozitif olmalı';
    
    // Fiyat validasyonu sadece yetkisi varsa yapılır
    if (canViewPrice) {
      if (!formData.price.trim()) next.price = 'Bu alan zorunlu';
      else if (Number(formData.price) < 0) next.price = 'Fiyat 0 veya pozitif olmalı';
    }
    
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    
    try {
      // Önce ürün bilgilerini güncelle
      const response = await updateProductAPI(product.id, {
        code: formData.code,
        name: formData.name,
        barcode: formData.barcode,
        critical: formData.critical,
        price: formData.price,
        desc: formData.desc,
        olcuBirimi: formData.olcuBirimi,
      });
      
      // Durum değiştiyse ayrı endpoint'e gönder
      if (formData.status !== oldStatus) {
        try {
          await updateProductStatusAPI(product.id, formData.status === 'active');
        } catch (statusErr) {
          if (isDevelopment) {
            console.error('Ürün durumu güncellenemedi', statusErr);
          }
          // Durum güncellemesi başarısız olsa bile diğer bilgiler güncellendi
        }
      }
      
      if (response.success || response.data) {
        setSuccess(true);
        onUpdate();
        // Diğer sayfalara ve tab'lara veri güncellemesi bildir
        broadcastMessage('product-updated', { productId: product.id });
        
        setTimeout(() => {
          setSuccess(false);
          onClose();
        }, 1500);
      } else {
        setErrors({ submit: response.message || 'Ürün güncellenemedi. Lütfen tekrar deneyin.' });
      }
    } catch (err) {
      if (isDevelopment) {
        console.error('Ürün güncellenemedi', err);
      }
      setErrors({ submit: err.message || 'Ürün güncellenemedi. Lütfen tekrar deneyin.' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/25 flex items-center justify-center px-4 z-50" onClick={onClose}>
      <div className="w-full max-w-md bg-white border border-neutral-300 rounded-2xl shadow-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base sm:text-lg font-semibold text-neutral-900">Ürün Düzenle</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-neutral-600 underline underline-offset-4"
            >
              Kapat
            </button>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Ürün Kodu
              </label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                placeholder="Kod"
                className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
              />
              {errors.code && <div className="text-xs text-red-600">{errors.code}</div>}
            </div>

            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Ürün Adı
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Ad"
                className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
              />
              {errors.name && <div className="text-xs text-red-600">{errors.name}</div>}
            </div>

            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Barkod
              </label>
              {cameraEnabled && (
                <div className="relative rounded-xl bg-neutral-100 aspect-[3/4] flex items-center justify-center text-neutral-500 overflow-hidden mb-2">
                  <div className="absolute inset-6 border-2 border-emerald-500/60 rounded-xl pointer-events-none" />
                  <video ref={videoRef} className="w-full h-full object-cover" muted playsInline autoPlay />
                  <span className="absolute text-sm bg-black/60 text-white px-3 py-1 rounded-full">Kamera önizleme</span>
                  <button
                    type="button"
                    onClick={closeCamera}
                    className="absolute top-3 right-3 rounded-full bg-black/70 text-white px-3 py-1 text-xs"
                  >
                    Kamerayı Kapat
                  </button>
                  {devices.length > 1 && (
                    <button
                      type="button"
                      onClick={switchCamera}
                      className="absolute top-3 left-3 rounded-full bg-black/70 text-white px-3 py-1 text-xs"
                    >
                      Kamera Değiştir
                    </button>
                  )}
                </div>
              )}
              <div className="relative">
                <input
                  type="text"
                  value={formData.barcode}
                  onChange={(e) => {
                    setFormData({ ...formData, barcode: e.target.value });
                    setCameraEnabled(false);
                  }}
                  placeholder="Barkod girin veya kamerayı kullanın"
                  className="w-full rounded-xl border border-neutral-200 px-3 py-2 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
                />
                <button
                  type="button"
                  onClick={openCamera}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg hover:bg-neutral-100 transition-colors"
                  title="Kamerayı aç"
                >
                  <svg
                    className="w-5 h-5 text-neutral-700"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              </div>
              {errors.barcode && <div className="text-xs text-red-600">{errors.barcode}</div>}
            </div>

            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Kritik Stok
              </label>
              <input
                type="number"
                value={formData.critical}
                onChange={(e) => setFormData({ ...formData, critical: e.target.value })}
                placeholder="0"
                className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
              />
              {errors.critical && <div className="text-xs text-red-600">{errors.critical}</div>}
            </div>

            {canViewPrice && (
              <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wide text-neutral-600">
                  Fiyat (TL)
                </label>
                <input
                  type="number"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
                />
                {errors.price && <div className="text-xs text-red-600">{errors.price}</div>}
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Ölçü Birimi
              </label>
              <div className="relative">
                <select
                  value={formData.olcuBirimi}
                  disabled
                  className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm appearance-none bg-neutral-100 text-neutral-600 cursor-not-allowed pr-8"
                >
                  <option value="adet">Adet</option>
                  <option value="m">Metre (m)</option>
                  <option value="mm">Milimetre (mm)</option>
                  <option value="kg">Kilogram (kg)</option>
                  <option value="gr">Gram (gr)</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-neutral-500">Ölçü birimi ürün oluşturulduktan sonra değiştirilemez</p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Durum
              </label>
              <div className="flex items-center gap-3">
                <span className="text-sm text-neutral-700">Pasif</span>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, status: formData.status === 'active' ? 'passive' : 'active' })}
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    formData.status === 'active' ? 'bg-emerald-600' : 'bg-neutral-300'
                  }`}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                      formData.status === 'active' ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
                <span className="text-sm text-neutral-700">Aktif</span>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-neutral-600">
                Açıklama
              </label>
              <textarea
                value={formData.desc}
                onChange={(e) => setFormData({ ...formData, desc: e.target.value })}
                rows={3}
                placeholder="İsteğe bağlı açıklama"
                className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
              />
            </div>

            <div className="bg-neutral-50 rounded-xl p-3 space-y-1 text-xs text-neutral-600">
              <div><strong>Toplam Giriş:</strong> {product.totalIn} {product.olcuBirimi || 'adet'}</div>
              <div><strong>Toplam Çıkış:</strong> {product.totalOut} {product.olcuBirimi || 'adet'}</div>
              <div><strong>Mevcut Stok:</strong> {product.stock} {product.olcuBirimi || 'adet'}</div>
            </div>
          </div>

          {success && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
              ✓ Ürün başarıyla güncellendi
            </div>
          )}
          {errors.submit && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
              {errors.submit}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-full py-2.5 text-sm font-semibold transition bg-neutral-200 text-neutral-700 hover:bg-neutral-300"
            >
              İptal
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 rounded-full py-2.5 text-sm font-semibold transition bg-neutral-900 text-white hover:bg-neutral-800"
            >
              Kaydet
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function UserManagementView({ onBack, aktifFirma, currentUserId }) {
  const [users, setUsers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [formData, setFormData] = useState({
    username: '',
    ad_soyad: '',
    password: '',
    role: 'Depo Personeli',
    permissions: [],
    status: 'active',
  });
  const [errors, setErrors] = useState({});
  const [allPermissions, setAllPermissions] = useState([]);
  const [allRoles, setAllRoles] = useState([]); // API'den gelen roller listesi (ID'ler için)

  // Roller mapping - API'den gelen "ad" değerlerini frontend permission key'lerine çevir
  // Her izin için unique key kullanılıyor
  const roleNameToKeyMap = {
    'Kullanıcı Yönetimi': 'user_manage',
    'Stok Durumu': 'stock_view',
    'Ürün Ekle': 'product_manage',
    'Stok Giriş / Çıkış': 'stock_movement',
    'Kontrol Paneli': 'dashboard',
    'Raporlar': 'reports',
    'Kritik stok düzenleme': 'critical_stock',
    'Stok Durumu Güncelleme': 'stock_status_update',
    'Stok Durum Fiyat': 'stock_price_view',
  };

  // Rol bazlı varsayılan izinler (artık kullanılmıyor, her izin bağımsız)
  const rolePermissions = {
    Admin: ['user_manage', 'product_manage', 'stock_view', 'stock_movement', 'dashboard', 'reports', 'critical_stock'],
    'Depo Sorumlusu': ['product_manage', 'stock_view', 'stock_movement', 'dashboard', 'reports', 'critical_stock'],
    'Depo Personeli': ['stock_view', 'stock_movement'],
  };

  useEffect(() => {
    loadUsers();
    loadRoles();
  }, []);

  // Kullanıcı listesi değiştiğinde sayfayı sıfırla
  useEffect(() => {
    setCurrentPage(1);
  }, [users.length]);

  const loadRoles = async () => {
    try {
      const response = await getRolesAPI();
      
      let rolesArray = null;
      
      // Response formatını kontrol et
      if (Array.isArray(response)) {
        rolesArray = response;
      } else if (response && response.data) {
        if (Array.isArray(response.data)) {
          rolesArray = response.data;
        } else if (response.data.roller && Array.isArray(response.data.roller)) {
          rolesArray = response.data.roller;
        } else if (response.data.roles && Array.isArray(response.data.roles)) {
          rolesArray = response.data.roles;
        } else if (typeof response.data === 'object') {
          const values = Object.values(response.data);
          const arrayValue = values.find(v => Array.isArray(v));
          if (arrayValue) {
            rolesArray = arrayValue;
          }
        }
      }
      
      if (rolesArray && rolesArray.length > 0) {
        // Tüm roller listesini sakla (ID'ler için)
        setAllRoles(rolesArray);
        
        // API'den gelen roller'i frontend formatına çevir
        // "Kritik stok düzenleme" seçeneğini filtrele
        const formattedPermissions = rolesArray
          .filter((role) => role.ad !== 'Kritik stok düzenleme')
          .map((role) => ({
            id: role.id,
            key: roleNameToKeyMap[role.ad] || role.ad.toLowerCase().replace(/\s+/g, '_'),
            label: role.ad,
            aciklama: role.aciklama || '',
          }));
        
        setAllPermissions(formattedPermissions);
      }
    } catch (err) {
      if (isDevelopment) {
        console.error('Roller yüklenemedi', err);
      }
      // Hata durumunda varsayılan roller
      setAllPermissions([
        { key: 'user_manage', label: 'Kullanıcı Yönetimi' },
        { key: 'product_manage', label: 'Ürün Ekle' },
        { key: 'stock_view', label: 'Stok Durumu' },
        { key: 'stock_movement', label: 'Stok Giriş / Çıkış' },
        { key: 'dashboard', label: 'Kontrol Paneli' },
        { key: 'reports', label: 'Raporlar' },
      ]);
    }
  };

  const loadUsers = async () => {
    try {
      const response = await getUsersAPI();
      
      let usersArray = null;
      
      // Response formatını kontrol et
      if (Array.isArray(response)) {
        usersArray = response;
      } else if (response && response.data) {
        if (Array.isArray(response.data)) {
          usersArray = response.data;
        } else if (response.data.kullanicilar && Array.isArray(response.data.kullanicilar)) {
          usersArray = response.data.kullanicilar;
        } else if (response.data.users && Array.isArray(response.data.users)) {
          usersArray = response.data.users;
        } else if (typeof response.data === 'object') {
          const values = Object.values(response.data);
          const arrayValue = values.find(v => Array.isArray(v));
          if (arrayValue) {
            usersArray = arrayValue;
          }
        }
      }
      
      if (usersArray && usersArray.length > 0) {
        // API'den gelen veriyi frontend formatına çevir
        const formattedUsers = usersArray.map((user) => {
          // Roller array'ini permissions'a çevir
          const rollerMap = {
            'Kullanıcı Yönetimi': 'user_manage',
            'Stok Durumu': 'stock_view',
            'Ürün Ekle': 'product_manage',
            'Stok Giriş / Çıkış': 'stock_movement',
            'Kontrol Paneli': 'dashboard',
            'Raporlar': 'reports',
            'Kritik stok düzenleme': 'critical_stock',
            'Stok Durumu Güncelleme': 'stock_status_update',
            'Stok Durum Fiyat': 'stock_price_view',
          };
          
          const permissions = (user.Roller || []).map(rol => rollerMap[rol] || rol).filter(Boolean);
          
          // Roller sayısına göre role belirle
          let role = 'Depo Personeli';
          if (permissions.includes('user_manage') && permissions.length >= 6) {
            role = 'Admin';
          } else if (permissions.length >= 3) {
            role = 'Depo Sorumlusu';
          }
          
          return {
            id: user.Id || user.id,
            username: user.KullaniciAdi || user.kullanici_adi || user.username || '',
            name: user.AdSoyad || user.ad_soyad || user.name || '',
            email: user.Email || user.email || '',
            role: role,
            permissions: permissions,
            status: (user.Aktif !== undefined ? user.Aktif : user.aktif !== undefined ? user.aktif : true) ? 'active' : 'passive',
          };
        });
        
        setUsers(formattedUsers);
      } else {
        setUsers([]);
      }
    } catch (err) {
      if (isDevelopment) {
        console.error('Kullanıcılar yüklenemedi', err);
      }
      setUsers([]);
    }
  };

  const handleAdd = () => {
    setEditingUser(null);
    setFormData({
      username: '',
      ad_soyad: '',
      password: '',
      role: 'Depo Personeli',
      permissions: [],
      status: 'active',
    });
    setErrors({});
    setShowModal(true);
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setFormData({
      username: user.username || '', // KullaniciAdi
      ad_soyad: user.name || '', // AdSoyad
      password: '', // Şifre güvenlik için gösterilmez, boş bırakılır
      role: user.role,
      permissions: user.permissions || [],
      status: user.status || 'active',
    });
    setErrors({});
    setShowModal(true);
  };

  const handleRoleChange = (role) => {
    setFormData({
      ...formData,
      role,
      permissions: rolePermissions[role] || [],
    });
  };

  const handlePermissionToggle = (permissionKey) => {
    const currentPermissions = formData.permissions || [];
    
    // Her izin bağımsız olarak seçilebilir
    const newPermissions = currentPermissions.includes(permissionKey)
      ? currentPermissions.filter((p) => p !== permissionKey)
      : [...currentPermissions, permissionKey];
    
    setFormData({
      ...formData,
      permissions: newPermissions,
    });
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.username.trim()) {
      newErrors.username = 'Kullanıcı adı zorunludur';
    }
    if (!formData.ad_soyad.trim()) {
      newErrors.ad_soyad = 'Ad soyad zorunludur';
    }
    if (!editingUser && !formData.password.trim()) {
      newErrors.password = 'Şifre zorunludur';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;

    try {
      // Seçilen izinlerin key'lerini API'den gelen roller listesindeki ID'lere çevir
      const rolIds = formData.permissions
        .map((permKey) => {
          // allPermissions'da bu key'e sahip olanı bul
          const perm = allPermissions.find((p) => p.key === permKey);
          if (perm && perm.id) {
            return perm.id;
          }
          return null;
        })
        .filter((id) => id !== null);

      let response;
      if (editingUser) {
        // Düzenleme için
        const userData = {
          kullanici_adi: formData.username, // KullaniciAdi - form'daki "Kullanıcı Adı" alanı
          ad_soyad: formData.ad_soyad, // AdSoyad
          email: '',
          rol_ids: rolIds,
          aktif: formData.status === 'active',
        };

        // Şifre varsa ekle
        if (formData.password && formData.password.trim()) {
          userData.sifre = formData.password;
        }

        response = await updateUserAPI(editingUser.id, userData);
      } else {
        // Yeni kullanıcı ekleme için
        response = await addUserAPI({
          kullanici_adi: formData.username,
          sifre: formData.password,
          ad_soyad: formData.ad_soyad,
          email: '',
          rol_ids: rolIds,
          aktif: formData.status === 'active',
        });
      }

      if (response && (response.success || response.data)) {
        // Başarılı - kullanıcı listesini yenile
        await loadUsers();
        
        // Güncellenen kullanıcıya tüm sekmelerde yetki güncellemesi bildirimi gönder
        if (editingUser) {
          broadcastMessage('user-permissions-updated', { userId: editingUser.id });
        }
        
        setShowModal(false);
        setEditingUser(null);
        setErrors({});
      } else {
        setErrors({ submit: response?.message || 'Kullanıcı kaydedilemedi. Lütfen tekrar deneyin.' });
      }
    } catch (err) {
      if (isDevelopment) {
        console.error('Kullanıcı kaydedilemedi', err);
      }
      const errorMessage = err.message || 'Kullanıcı kaydedilemedi. Lütfen tekrar deneyin.';
      
      // Kullanıcı adı hatası kontrolü
      if (errorMessage.toLowerCase().includes('kullanıcı adı') || 
          errorMessage.toLowerCase().includes('zaten kullanılıyor') ||
          errorMessage.toLowerCase().includes('username')) {
        setErrors({ username: errorMessage });
      } else {
        setErrors({ submit: errorMessage });
      }
    }
  };

  const getRoleLabel = (role) => {
    return role;
  };

  return (
    <section className="space-y-5 relative" aria-label="Kullanıcı yönetimi">
      {!showModal && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-900">Kullanıcı Yönetimi</h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleAdd}
                className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 transition-colors"
                title="Yeni kullanıcı ekle"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onBack}
                className="text-sm text-neutral-700 underline underline-offset-4"
              >
                Menüye dön
              </button>
            </div>
          </div>
        </>
      )}

      {!showModal && (
        <div className="space-y-4">
          {users.length === 0 ? (
            <div className="rounded-2xl border border-neutral-200 bg-white px-6 py-12 text-center text-neutral-600">
              Henüz kullanıcı eklenmemiş
            </div>
          ) : (
            <>
              {(() => {
                const totalPages = Math.ceil(users.length / itemsPerPage);
                const startIndex = (currentPage - 1) * itemsPerPage;
                const endIndex = startIndex + itemsPerPage;
                const paginatedUsers = users.slice(startIndex, endIndex);
                
                return (
                  <>
                    <div className={users.length > 5 ? 'overflow-y-auto max-h-[20rem] min-h-0 space-y-4' : 'space-y-4'}>
                      {paginatedUsers.map((user) => (
              <div
                key={user.id}
                className={`rounded-xl border border-neutral-200 bg-white p-3 sm:p-5 ${
                  user.status === 'passive' ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2 sm:gap-4">
                  <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-neutral-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-base sm:text-lg font-semibold text-neutral-700">
                        {(user.username || user.name).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm sm:text-base font-semibold mb-1 truncate ${
                        user.status === 'passive' ? 'text-neutral-500' : 'text-neutral-900'
                      }`}>
                        {user.username || user.name}
                      </div>
                      <div className="text-xs sm:text-sm text-neutral-600 mb-1 sm:mb-2 truncate">{getRoleLabel(user.role)}</div>
                      <span
                        className={`inline-block px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-semibold ${
                          user.status === 'active'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-neutral-100 text-neutral-600'
                        }`}
                      >
                        {user.status === 'active' ? 'Aktif' : 'Pasif'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleEdit(user)}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg border border-neutral-300 text-neutral-700 text-xs sm:text-sm font-medium hover:bg-neutral-50 transition-colors flex-shrink-0 whitespace-nowrap"
                  >
                    Düzenle
                  </button>
                </div>
              </div>
                      ))}
                    </div>
                    {users.length > itemsPerPage && (
                      <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        itemsPerPage={itemsPerPage}
                        totalItems={users.length}
                        onPageChange={setCurrentPage}
                        onItemsPerPageChange={(value) => {
                          setItemsPerPage(value);
                          setCurrentPage(1);
                        }}
                      />
                    )}
                  </>
                );
              })()}
            </>
          )}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/25 flex items-start sm:items-center justify-center px-2 sm:px-4 py-2 sm:py-4 z-50 overflow-y-auto">
          <div className="w-full max-w-md bg-white border border-neutral-300 rounded-2xl shadow-lg my-auto max-h-[95vh] sm:max-h-[90vh] flex flex-col min-h-0">
            <UserModal
              formData={formData}
              setFormData={setFormData}
              errors={errors}
              allPermissions={allPermissions}
              rolePermissions={rolePermissions}
              onRoleChange={handleRoleChange}
              onPermissionToggle={handlePermissionToggle}
              onSave={handleSave}
              onClose={() => {
                setShowModal(false);
                setEditingUser(null);
                setErrors({});
              }}
              isEditing={!!editingUser}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function UserModal({
  formData,
  setFormData,
  errors,
  allPermissions,
  rolePermissions,
  onRoleChange,
  onPermissionToggle,
  onSave,
  onClose,
  isEditing,
}) {
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex-shrink-0 p-4 sm:p-6 border-b border-neutral-200">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base sm:text-lg font-semibold text-neutral-900">
            {isEditing ? 'Kullanıcı Düzenle' : 'Yeni Kullanıcı Ekle'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-xs sm:text-sm text-neutral-600 underline underline-offset-4 flex-shrink-0"
          >
            Kapat
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0">
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="block text-xs uppercase tracking-wide text-neutral-600">
              Kullanıcı Adı
            </label>
            <input
              type="text"
              value={formData.username}
              onChange={(e) => {
                setFormData({ ...formData, username: e.target.value });
                // Kullanıcı yazmaya başladığında hata mesajını temizle
                if (errors.username) {
                  setErrors({ ...errors, username: '' });
                }
              }}
              placeholder="Kullanıcı adı"
              className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
            />
            {errors.username && <div className="text-xs text-red-600">{errors.username}</div>}
          </div>

          <div className="space-y-1">
            <label className="block text-xs uppercase tracking-wide text-neutral-600">
              Ad Soyad
            </label>
            <input
              type="text"
              value={formData.ad_soyad}
              onChange={(e) => setFormData({ ...formData, ad_soyad: e.target.value })}
              placeholder="Ad soyad"
              className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
            />
            {errors.ad_soyad && <div className="text-xs text-red-600">{errors.ad_soyad}</div>}
          </div>

          <div className="space-y-1">
            <label className="block text-xs uppercase tracking-wide text-neutral-600">
              Şifre {isEditing && <span className="text-neutral-400 font-normal text-[10px] sm:text-xs">(Değiştirmek için yeni şifre girin)</span>}
            </label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder={isEditing ? "Yeni şifre (boş bırakılırsa değişmez)" : "Şifre"}
              className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
            />
            {errors.password && <div className="text-xs text-red-600">{errors.password}</div>}
          </div>

        <div className="space-y-1">
          <label className="block text-xs uppercase tracking-wide text-neutral-600">Rol</label>
          <div className="relative">
            <select
              value={formData.role}
              onChange={(e) => onRoleChange(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900 appearance-none bg-white pr-8"
            >
              <option value="Admin">Admin</option>
              <option value="Depo Sorumlusu">Depo Sorumlusu</option>
              <option value="Depo Personeli">Depo Personeli</option>
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg className="w-4 h-4 text-neutral-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
          {errors.role && <div className="text-xs text-red-600">{errors.role}</div>}
        </div>

        <div className="space-y-2">
          <label className="block text-xs uppercase tracking-wide text-neutral-600">İzinler</label>
          <div className="space-y-2">
            {allPermissions.map((perm) => {
              const isChecked = formData.permissions.includes(perm.key);
              
              return (
                <label
                  key={perm.key}
                  className="flex items-center gap-2 text-sm text-neutral-900"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onPermissionToggle(perm.key)}
                    className="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-2 focus:ring-neutral-800 focus:ring-offset-0"
                  />
                  <span>{perm.label}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs uppercase tracking-wide text-neutral-600">Durum</label>
          <div className="flex items-center gap-3">
            <span className="text-sm text-neutral-700">Pasif</span>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, status: formData.status === 'active' ? 'passive' : 'active' })}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                formData.status === 'active' ? 'bg-blue-600' : 'bg-neutral-300'
              }`}
            >
              <span
                className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  formData.status === 'active' ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-sm text-neutral-700">Aktif</span>
          </div>
        </div>
        </div>
      </div>

      <div className="flex-shrink-0 flex items-center gap-2 sm:gap-3 p-3 sm:p-4 md:p-6 border-t border-neutral-200 bg-white">
        <button
          type="button"
          onClick={onSave}
          className="flex-1 rounded-full bg-blue-600 text-white py-2 sm:py-2.5 text-xs sm:text-sm font-semibold hover:bg-blue-700"
        >
          {isEditing ? 'Güncelle' : 'Kaydet'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-full border border-neutral-300 text-neutral-700 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold hover:bg-neutral-100"
        >
          İptal
        </button>
      </div>
    </div>
  );
}

function Pagination({ currentPage, totalPages, itemsPerPage, totalItems, onPageChange, onItemsPerPageChange }) {
  // onItemsPerPageChange optional - sadece bazı sayfalarda kullanılıyor
  const getPageNumbers = () => {
    const pages = [];
    
    // Her zaman 1'i göster
    pages.push(1);
    
    // Mevcut sayfanın etrafında sayfa numaraları göster
    const startPage = Math.max(2, currentPage - 1);
    const endPage = Math.min(totalPages, currentPage + 1);
    
    // Eğer başlangıç sayfası 1'den büyükse ve 2'den büyükse ... ekle
    if (startPage > 2) {
      pages.push('...');
    }
    
    // Mevcut sayfanın etrafındaki sayfaları ekle
    for (let i = startPage; i <= endPage; i++) {
      if (i !== 1) { // 1'i zaten ekledik
        pages.push(i);
      }
    }
    
    // Eğer son sayfa gösterilen sayfalardan büyükse ... ekle
    if (endPage < totalPages) {
      pages.push('...');
    }
    
    return pages;
  };

  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  return (
    <div className="flex items-center justify-center gap-1 px-4 py-3 bg-white border border-neutral-200 rounded-xl">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="px-2 py-1 rounded border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title="İlk sayfa"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="px-2 py-1 rounded border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Önceki sayfa"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        
        {getPageNumbers().map((page, idx) => (
          page === '...' ? (
            <span key={`ellipsis-${idx}`} className="px-2 py-1 text-sm text-neutral-500">
              ...
            </span>
          ) : (
            <button
              key={page}
              type="button"
              onClick={() => onPageChange(page)}
              className={`px-3 py-1 rounded border text-sm font-semibold transition-colors ${
                currentPage === page
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              {page}
            </button>
          )
        ))}
        
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="px-2 py-1 rounded border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Sonraki sayfa"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className="px-2 py-1 rounded border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Son sayfa"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function UserMenuButton({ firmaAdi, kullaniciAdi, onLogout, isOpen, onToggle, onClose }) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (!e.target.closest('.user-menu-container')) {
        onClose();
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [isOpen, onClose]);

  return (
    <div className="relative user-menu-container">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary-50 border border-primary-100 hover:bg-primary-100 transition-all duration-200"
      >
        <div className="w-7 h-7 rounded-full bg-primary-800 flex items-center justify-center">
          <span className="text-white text-xs font-semibold">{kullaniciAdi?.charAt(0)?.toUpperCase() || 'U'}</span>
        </div>
        <svg
          className={`w-3.5 h-3.5 text-primary-600 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-60 rounded-xl border border-gray-100 bg-white shadow-elevated z-50 overflow-hidden animate-scale-in">
          <div className="px-4 py-3.5 border-b border-gray-100 bg-gray-50/50">
            <div className="text-xs font-medium text-primary-500 mb-1">Firma</div>
            <div className="text-sm font-semibold text-primary-900">{firmaAdi}</div>
          </div>
          <div className="px-4 py-3.5 border-b border-gray-100">
            <div className="text-xs font-medium text-primary-500 mb-1">Kullanıcı</div>
            <div className="text-sm font-semibold text-primary-900">{kullaniciAdi}</div>
          </div>
          <div className="p-2.5">
            <button
              type="button"
              onClick={() => {
                onLogout();
                onClose();
              }}
              className="w-full px-4 py-2.5 rounded-lg bg-red-50 text-red-700 text-sm font-semibold hover:bg-red-100 transition-all duration-200"
            >
              Çıkış Yap
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
