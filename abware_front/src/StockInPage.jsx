import { useState, useEffect, useRef } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { getProductByBarcode as getProductByBarcodeLocal, addMovement as addMovementLocal, calculateProductStocks } from './storage';
import { getProductByBarcode as getProductByBarcodeAPI, getRafs as getRafsAPI, getRafsByUrunId, addStockEntryV2, addStockExitV2, transferV2 } from './api';
import { broadcastMessage } from './broadcastChannel';
import { sanitizeString, sanitizeHTML } from './sanitize';

export default function StockInPage({ onBack, aktifFirma }) {
  const [manual, setManual] = useState('');
  const [valid, setValid] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [activeInput, setActiveInput] = useState('barkod'); // 'barkod' veya 'rafBarkodu'
  const [devices, setDevices] = useState([]);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [scanError, setScanError] = useState('');
  const [islemTuru, setIslemTuru] = useState(null);
  const [miktar, setMiktar] = useState('');
  const [rafBarkodu, setRafBarkodu] = useState('');
  const [kaynakRafBarkodu, setKaynakRafBarkodu] = useState('');
  const [hedefRafBarkodu, setHedefRafBarkodu] = useState('');
  const [kartKilitli, setKartKilitli] = useState(false);
  const [ikinciKartKilitli, setIkinciKartKilitli] = useState(false);
  const [aktifKart, setAktifKart] = useState(1); // 1: Ürün Barkodu, 2: Kaynak Raf, 3: Ürün Barkodu (tekrar), 4: Hedef Raf
  const [urunTekrarOkutuldu, setUrunTekrarOkutuldu] = useState(false);
  const [urunTekrarBarkod, setUrunTekrarBarkod] = useState(''); // 3. adımda tekrar okutulan barkod (geri gidince veri kalsın diye manual ayrı tutuluyor)
  const [aciklama, setAciklama] = useState('');
  const [foundProduct, setFoundProduct] = useState(null);
  const [foundRaf, setFoundRaf] = useState(null);
  const [foundKaynakRaf, setFoundKaynakRaf] = useState(null);
  const [foundHedefRaf, setFoundHedefRaf] = useState(null);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [passiveWarning, setPassiveWarning] = useState(false);
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const controlsRef = useRef(null);
  const slideRefs = useRef([]);
  const [urunRafStoklari, setUrunRafStoklari] = useState([]); // Ürünün raflardaki dağılımı: { rafKodu, rafAdi, adet }

  useEffect(() => {
    const isValid = manual.trim().length > 0;
    setValid(false);
    setFoundProduct(null);
    setPassiveWarning(false);
    
    // Barkod değiştiğinde API'den ürün bilgisini çek
    if (isValid) {
      const fetchProduct = async () => {
        try {
          const response = await getProductByBarcodeAPI(manual.trim());
          
          if (response.success && response.data) {
            const productData = response.data;
            
            // API'den gelen veriyi frontend formatına çevir
            const product = {
              id: productData.urun_id,
              code: productData.urun_kodu,
              name: productData.urun_adi,
              barcode: productData.barkod,
              stock: productData.stok || 0,
              criticalStock: productData.kritik_stok || 0,
              olcuBirimi: productData.adet_turu || 'adet',
              status: 'active', // API'den aktif/pasif bilgisi gelmiyorsa varsayılan aktif
            };
            
            setFoundProduct(product);
            setValid(true);
            setPassiveWarning(false);
          } else {
            setFoundProduct(null);
            setValid(false);
            setPassiveWarning(false);
          }
        } catch (err) {
          // Ürün bilgisi alınamadı
          // Pasif ürün hatası için özel mesaj göster
          if (err.code === 'PRODUCT_INACTIVE') {
            // Pasif ürün için ürün bilgilerini göster (API'den gelen veri yoksa boş bırak)
            setFoundProduct(null);
            setValid(false);
            setPassiveWarning(true);
            setSubmitError('');
          } else {
            setFoundProduct(null);
            setValid(false);
            setPassiveWarning(false);
            setSubmitError('');
          }
        }
      };
      
      // Debounce için kısa bir gecikme
      const timeoutId = setTimeout(() => {
        fetchProduct();
      }, 300);
      
      return () => clearTimeout(timeoutId);
    }
  }, [manual]);

  useEffect(() => {
    if (cameraEnabled) {
      startScan();
    } else {
      stopScan();
    }
    return () => stopScan();
  }, [cameraEnabled, deviceIndex]);

  // İşlem türü değiştiğinde kart durumunu sıfırla
  useEffect(() => {
    if (islemTuru !== 'transfer') {
      setKartKilitli(false);
      setIkinciKartKilitli(false);
      setKaynakRafBarkodu('');
      setHedefRafBarkodu('');
      setAktifKart(1);
      setUrunTekrarOkutuldu(false);
      setUrunTekrarBarkod('');
    } else if (islemTuru === 'transfer') {
      setAktifKart(1);
    }
  }, [islemTuru]);

  // Barkod okutulduktan sonra otomatik ilerleme yok; kullanıcı İlerle/ok ile kendisi geçer.

  // Ürün seçildiğinde bu ürünün hangi raflarda kaç adet olduğunu API'den çek
  useEffect(() => {
    if (!foundProduct?.id) {
      setUrunRafStoklari([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const response = await getRafsByUrunId(foundProduct.id);
        if (cancelled) return;
        const raw = response?.data;
        const list = raw?.tum_raflar || raw?.normal || raw?.mal_kabul || raw?.cikis || [];
        const raflarList = Array.isArray(list) ? list : [];
        const rafStokList = raflarList
          .map((r) => ({
            rafKodu: (r.RafKodu ?? r.raf_kodu ?? '').trim(),
            rafAdi: (r.RafAdi ?? r.raf_adi ?? '').trim(),
            adet: Number(r.UrunAdet ?? r.urun_adet ?? 0),
          }))
          .filter((r) => r.adet > 0);
        setUrunRafStoklari(rafStokList);
      } catch {
        if (!cancelled) setUrunRafStoklari([]);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [foundProduct?.id]);

  // Raf barkodu değiştiğinde raf bilgisini çek (giriş/çıkış için)
  useEffect(() => {
    if (rafBarkodu.trim().length >= 3 && islemTuru !== 'transfer') {
      const fetchRaf = async () => {
        try {
          const response = await getRafsAPI();
          if (response.success && response.data && response.data.tum_raflar) {
            const raf = response.data.tum_raflar.find(
              (r) => r.RafKodu && r.RafKodu.trim().toLowerCase() === rafBarkodu.trim().toLowerCase()
            );
            setFoundRaf(raf || null);
          } else {
            setFoundRaf(null);
          }
        } catch (err) {
          setFoundRaf(null);
        }
      };
      
      const timeoutId = setTimeout(() => {
        fetchRaf();
      }, 300);
      
      return () => clearTimeout(timeoutId);
    } else {
      setFoundRaf(null);
    }
  }, [rafBarkodu, islemTuru]);

  // Raf kodunu tek yerden oku (API RafKodu veya raf_kodu dönebilir)
  const getRafKodu = (r) => (r && (r.RafKodu || r.raf_kodu || '')).trim().toLowerCase();

  // Kaynak raf barkodu değiştiğinde raf bilgisini çek
  useEffect(() => {
    if (kaynakRafBarkodu.trim().length >= 3 && islemTuru === 'transfer') {
      const fetchRaf = async () => {
        try {
          const response = await getRafsAPI();
          if (response.success && response.data && response.data.tum_raflar) {
            const list = response.data.tum_raflar;
            const raf = list.find(
              (r) => getRafKodu(r) === kaynakRafBarkodu.trim().toLowerCase()
            );
            setFoundKaynakRaf(raf || null);
          } else {
            setFoundKaynakRaf(null);
          }
        } catch (err) {
          setFoundKaynakRaf(null);
        }
      };
      
      const timeoutId = setTimeout(() => {
        fetchRaf();
      }, 300);
      
      return () => clearTimeout(timeoutId);
    } else {
      setFoundKaynakRaf(null);
    }
  }, [kaynakRafBarkodu, islemTuru]);

  // Hedef raf barkodu değiştiğinde raf bilgisini çek
  useEffect(() => {
    if (hedefRafBarkodu.trim().length >= 3 && islemTuru === 'transfer') {
      const fetchRaf = async () => {
        try {
          const response = await getRafsAPI();
          if (response.success && response.data && response.data.tum_raflar) {
            const list = response.data.tum_raflar;
            const raf = list.find(
              (r) => getRafKodu(r) === hedefRafBarkodu.trim().toLowerCase()
            );
            setFoundHedefRaf(raf || null);
          } else {
            setFoundHedefRaf(null);
          }
        } catch (err) {
          setFoundHedefRaf(null);
        }
      };
      
      const timeoutId = setTimeout(() => {
        fetchRaf();
      }, 300);
      
      return () => clearTimeout(timeoutId);
    } else {
      setFoundHedefRaf(null);
    }
  }, [hedefRafBarkodu, islemTuru]);

  // Kaynak raf alanı boşalınca kilidi aç; raf bulunduğunda otomatik kilitleme/ilerleme yok, kullanıcı istediğinde silebilir veya İleri ile geçer
  useEffect(() => {
    if (islemTuru === 'transfer' && !kaynakRafBarkodu.trim()) {
      setKartKilitli(false);
    }
  }, [kaynakRafBarkodu, islemTuru]);

  // 3. adımda tekrar okutulan barkod 1. adımdaki ürünle eşleşince doğrula
  useEffect(() => {
    if (islemTuru !== 'transfer' || !foundProduct) return;
    const match = urunTekrarBarkod.trim().toLowerCase() === manual.trim().toLowerCase() && urunTekrarBarkod.trim().length > 0;
    setUrunTekrarOkutuldu(match);
  }, [urunTekrarBarkod, manual, foundProduct, islemTuru]);

  // Hedef raf alanı boşalınca kilidi aç; raf bulunduğunda otomatik kilitleme yok, kullanıcı istediğinde silebilir veya Tamam ile onaylar
  useEffect(() => {
    if (islemTuru === 'transfer' && !hedefRafBarkodu.trim()) {
      setIkinciKartKilitli(false);
    }
  }, [hedefRafBarkodu, islemTuru]);

  const startScan = async () => {
    setScanError('');
    try {
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
            if (activeInput === 'barkod') {
              setManual(text);
              setValid(text.trim().length >= 6);
            } else if (activeInput === 'urunTekrarBarkod') {
              setUrunTekrarBarkod(text);
            } else if (activeInput === 'rafBarkodu') {
              setRafBarkodu(text);
            } else if (activeInput === 'kaynakRafBarkodu') {
              setKaynakRafBarkodu(text);
            } else if (activeInput === 'hedefRafBarkodu') {
              setHedefRafBarkodu(text);
            }
            setCameraEnabled(false);
          }
          if (err && err.name !== 'NotFoundException') {
            setScanError('Okuma hatası');
          }
        }
      );
      controlsRef.current = controls;
    } catch (err) {
      // Hata oluştu
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

  const openCamera = (inputType = 'barkod') => {
    setActiveInput(inputType);
    setCameraEnabled(true);
  };
  const closeCamera = () => setCameraEnabled(false);
  const switchCamera = () => {
    if (!devices.length) return;
    const next = (deviceIndex + 1) % devices.length;
    setDeviceIndex(next);
    setCameraEnabled(false);
    setTimeout(() => setCameraEnabled(true), 50);
  };

  const miktarNum = Number(miktar) || 0;
  const canSubmitTransfer =
    valid &&
    foundProduct &&
    miktarNum > 0 &&
    kaynakRafBarkodu.trim() &&
    hedefRafBarkodu.trim() &&
    urunTekrarOkutuldu;
  const canSubmit =
    islemTuru === 'transfer'
      ? canSubmitTransfer
      : valid && foundProduct && miktarNum > 0;

  const handleAdjust = (delta) => {
    const current = miktarNum || 0;
    const next = Math.max(0, current + delta);
    setMiktar(String(next));
  };

  const handleSubmit = async () => {
    if (!foundProduct) {
      setSubmitError('Lütfen geçerli bir barkod girin.');
      return;
    }
    
    if (foundProduct.status === 'passive') {
      setSubmitError('Bu ürün pasif durumdadır. Pasif ürünlerde stok hareketi yapılamaz.');
      return;
    }
    
    if (miktarNum <= 0) {
      setSubmitError('Miktar 0\'dan büyük olmalıdır.');
      return;
    }
    
    // Giriş işleminde raf barkodu zorunlu
    if (islemTuru === 'giris' && !rafBarkodu.trim()) {
      setSubmitError('Giriş işlemi için raf barkodu zorunludur.');
      return;
    }
    
    // Transfer işleminde kaynak raf, hedef raf ve ürün tekrar okutma zorunlu
    if (islemTuru === 'transfer') {
      if (!kaynakRafBarkodu.trim()) {
        setSubmitError('Transfer için kaynak raf barkodu zorunludur.');
        return;
      }
      if (!hedefRafBarkodu.trim()) {
        setSubmitError('Transfer için hedef raf barkodu zorunludur.');
        return;
      }
      if (!urunTekrarOkutuldu) {
        setSubmitError('Transfer için ürünü tekrar okutmanız gerekmektedir.');
        return;
      }
    }
    
    try {
      // Input'ları temizle (XSS koruması)
      const cleanBarcode = sanitizeString(manual.trim());
      const cleanDescription = sanitizeHTML(aciklama);
      
      // Raf barkodunu temizle
      const cleanRafBarkodu = sanitizeString(rafBarkodu.trim());
      const cleanKaynakRafBarkodu = sanitizeString(kaynakRafBarkodu.trim());
      const cleanHedefRafBarkodu = sanitizeString(hedefRafBarkodu.trim());
      
      // Açıklamaya raf barkodunu ekle (varsa)
      let finalAciklama = cleanDescription;
      if (islemTuru === 'transfer') {
        if (cleanKaynakRafBarkodu && cleanHedefRafBarkodu) {
          finalAciklama = finalAciklama ? `${finalAciklama} | Kaynak Raf: ${cleanKaynakRafBarkodu} | Hedef Raf: ${cleanHedefRafBarkodu}` : `Kaynak Raf: ${cleanKaynakRafBarkodu} | Hedef Raf: ${cleanHedefRafBarkodu}`;
        } else if (cleanKaynakRafBarkodu) {
          finalAciklama = finalAciklama ? `${finalAciklama} | Kaynak Raf: ${cleanKaynakRafBarkodu}` : `Kaynak Raf: ${cleanKaynakRafBarkodu}`;
        }
      } else if (cleanRafBarkodu) {
        finalAciklama = finalAciklama ? `${finalAciklama} | Raf: ${cleanRafBarkodu}` : `Raf: ${cleanRafBarkodu}`;
      }
      
      // API'ye temizlenmiş veriyi gönder
      let response;
      
      if (islemTuru === 'giris') {
        // Giriş işlemi için entry-v2 endpoint'ini kullan
        response = await addStockEntryV2(
          cleanBarcode,
          cleanRafBarkodu || '', // hedef_raf_barkodu
          miktarNum,
          finalAciklama,
          '' // giris_rafi_barkodu (şimdilik boş)
        );
      } else if (islemTuru === 'transfer') {
        // Transfer işlemi için transfer-v2 endpoint'ini kullan (ürün barkodu → kaynak raf → ürün tekrar → hedef raf)
        response = await transferV2({
          kaynak_raf_barkodu: cleanKaynakRafBarkodu,
          barkod: cleanBarcode,
          adet: miktarNum,
          aciklama: finalAciklama,
          hedef_raf_barkodu: cleanHedefRafBarkodu,
          hedef_urun_barkodu: cleanBarcode,
        });
      } else {
        // Çıkış için exit-v2 endpoint'i (kaynak raf = raf barkodu, çıkış rafı = aynı raf)
        response = await addStockExitV2(
          cleanRafBarkodu,
          cleanRafBarkodu, // cikis_rafi_barkodu (tek raf alanı var, aynı kullanılıyor)
          cleanBarcode,
          miktarNum,
          finalAciklama
        );
      }
      
      if (response.success || response.data) {
        setSuccess(true);
        setSubmitError('');
        
        // Formu temizle
        setManual('');
        setMiktar('');
        setRafBarkodu('');
        setKaynakRafBarkodu('');
        setHedefRafBarkodu('');
        setKartKilitli(false);
        setIkinciKartKilitli(false);
        setUrunTekrarOkutuldu(false);
        setUrunTekrarBarkod('');
        setAktifKart(1);
        setAciklama('');
        setFoundProduct(null);
        setValid(false);
        
        // Diğer sayfalara ve tab'lara veri güncellemesi bildir
        broadcastMessage('stock-movement', { type: islemTuru, amount: miktarNum });
        
        // Başarı mesajını 3 saniye sonra kaldır
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setSubmitError(response.message || 'Stok hareketi kaydedilemedi. Lütfen tekrar deneyin.');
      }
    } catch (err) {
      // Stok hareketi kaydedilemedi
      setSubmitError(err.message || 'Stok hareketi kaydedilemedi. Lütfen tekrar deneyin.');
    }
  };

  if (islemTuru === null) {
    return (
      <section className="space-y-1" aria-label="Stok giriş">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-neutral-900">Stok Giriş / Çıkış</h2>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-neutral-700 underline underline-offset-4"
          >
            Menüye dön
          </button>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-6 space-y-4">
          <div className="text-center space-y-1">
            <p className="text-sm text-neutral-500 uppercase tracking-wide">İşlem Türü Seçin</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setIslemTuru('giris')}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-neutral-200 bg-white px-4 py-8 text-neutral-800 hover:border-neutral-900 hover:bg-neutral-50 transition-all active:scale-95"
            >
              <span className="text-3xl">📥</span>
              <span className="text-base font-bold tracking-wide">GİRİŞ</span>
            </button>
            <button
              type="button"
              onClick={() => setIslemTuru('cikis')}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-neutral-200 bg-white px-4 py-8 text-neutral-800 hover:border-neutral-900 hover:bg-neutral-50 transition-all active:scale-95"
            >
              <span className="text-3xl">📤</span>
              <span className="text-base font-bold tracking-wide">ÇIKIŞ</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => setIslemTuru('transfer')}
            className="w-full flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-neutral-200 bg-white px-4 py-6 text-neutral-800 hover:border-neutral-900 hover:bg-neutral-50 transition-all active:scale-95"
          >
            <span className="text-3xl">🔄</span>
            <span className="text-base font-bold tracking-wide">TRANSFER</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-1" aria-label="Stok giriş">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-neutral-900">Stok Giriş / Çıkış</h2>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-neutral-700 underline underline-offset-4"
        >
          Menüye dön
        </button>
      </div>

      <div className="space-y-0.2 rounded-2xl border border-neutral-200 bg-white p-4">
        {cameraEnabled && (
          <div className="relative rounded-xl bg-neutral-100 aspect-[3/4] flex items-center justify-center text-neutral-500 overflow-hidden">
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
            <button
              type="button"
              onClick={switchCamera}
              className="absolute top-3 left-3 rounded-full bg-black/70 text-white px-3 py-1 text-xs"
              disabled={!devices.length}
            >
              Kamera Değiştir
            </button>
          </div>
        )}

        <div className="space-y-1">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-neutral-900">
                {islemTuru === 'giris' ? '📥 GİRİŞ' : islemTuru === 'cikis' ? '📤 ÇIKIŞ' : '🔄 TRANSFER'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setIslemTuru(null);
                setManual('');
                setMiktar('');
                setRafBarkodu('');
                setKaynakRafBarkodu('');
                setHedefRafBarkodu('');
                setKartKilitli(false);
                setIkinciKartKilitli(false);
                setUrunTekrarOkutuldu(false);
                setUrunTekrarBarkod('');
                setAktifKart(1);
                setFoundProduct(null);
                setValid(false);
                setSubmitError('');
                setSuccess(false);
              }}
              className="text-xs text-neutral-500 underline underline-offset-4 hover:text-neutral-800"
            >
              Değiştir
            </button>
          </div>

        {(
          <div
            className="relative overflow-hidden"
          >
            <div 
              className="flex transition-transform duration-300 ease-in-out"
              style={{ transform: `translateX(-${(aktifKart - 1) * 100}%)` }}
              onTouchStart={(e) => setTouchStart(e.targetTouches[0].clientX)}
              onTouchMove={(e) => setTouchEnd(e.targetTouches[0].clientX)}
              onTouchEnd={() => {
                if (!touchStart || !touchEnd) return;
                const distance = touchStart - touchEnd;
                const isLeftSwipe = distance > 50;
                const isRightSwipe = distance < -50;
                
                if (isLeftSwipe) {
                  // Sola kaydırma - ileri git
                  if (islemTuru === 'transfer') {
                    if (aktifKart < 4) {
                      if (aktifKart === 1 && foundProduct) {
                        setAktifKart(2);
                      } else if (aktifKart === 2 && kaynakRafBarkodu.trim()) {
                        setAktifKart(3);
                      } else if (aktifKart === 3 && urunTekrarOkutuldu) {
                        setAktifKart(4);
                      }
                    }
                  } else if (islemTuru === 'giris' || islemTuru === 'cikis') {
                    if (aktifKart < 2 && aktifKart === 1 && foundProduct) {
                      setAktifKart(2);
                    }
                  }
                }
                if (isRightSwipe && aktifKart > 1) {
                  // Sağa kaydırma - geri git
                  setAktifKart(aktifKart - 1);
                }
                
                setTouchStart(null);
                setTouchEnd(null);
              }}
            >
              {islemTuru === 'transfer' ? (
                <>
              {/* Transfer - Sayfa 1: Ürün Barkodu */}
              <div ref={(el) => (slideRefs.current[0] = el)} className="w-full flex-shrink-0 px-1">
                <div className="space-y-2 rounded-2xl border-2 border-neutral-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-neutral-600"> 1. ADIM</div>
                      <h3 className="text-lg font-bold text-neutral-900">📦 ÜRÜN BARKODU</h3>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wide text-neutral-600">Ürün Barkodu</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={manual}
                        onChange={(e) => {
                          setManual(e.target.value);
                          setCameraEnabled(false);
                        }}
                        placeholder="Alınacak ürünü okut"
                        className="w-full rounded-xl border border-neutral-200 px-3 py-3 pr-12 text-base focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
                      />
                      {valid && foundProduct && (
                        <span className="absolute right-12 top-1/2 -translate-y-1/2 text-emerald-600 text-sm font-semibold">
                          ✓
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => openCamera('barkod')}
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
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z"
                          />
                        </svg>
                      </button>
                    </div>
                    {foundProduct && !passiveWarning && (
                      <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700 space-y-0.5">
                        <div className="font-semibold text-emerald-900 text-sm">{foundProduct.name}</div>
                        {urunRafStoklari.length > 0 && urunRafStoklari.map((r) => (
                          <div key={r.rafKodu || r.rafAdi}>{r.rafAdi || r.rafKodu || 'Raf'} {r.adet} {foundProduct?.olcuBirimi || 'adet'}</div>
                        ))}
                      </div>
                    )}
                    {manual.trim().length >= 6 && !foundProduct && !passiveWarning && (
                      <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
                        Bu barkoda ait ürün bulunamadı
                      </div>
                    )}
                  </div>

                  {foundProduct && (
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => setAktifKart(2)}
                        className="h-10 w-10 rounded-full border border-neutral-300 text-lg font-semibold text-neutral-700 hover:bg-neutral-100 flex items-center justify-center"
                        title="İleri"
                      >
                        →
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Transfer - Sayfa 2: Kaynak Raf Barkodu */}
              <div ref={(el) => (slideRefs.current[1] = el)} className="w-full flex-shrink-0 px-1">
                <div className={`space-y-2 rounded-2xl border-2 p-3 ${kartKilitli ? 'border-emerald-500 bg-emerald-50/30' : 'border-neutral-200 bg-white'}`}>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-neutral-600"> 2. ADIM</div>
                      <h3 className="text-lg font-bold text-neutral-900">📦 KAYNAK RAF BARKODU</h3>
                    </div>
                    {kartKilitli && (
                      <span className="text-emerald-600 text-xl">✔️</span>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wide text-neutral-600">Kaynak Raf Barkodu</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={kaynakRafBarkodu}
                        onChange={(e) => {
                          setKaynakRafBarkodu(e.target.value);
                          setCameraEnabled(false);
                        }}
                        placeholder="Ürünün bulunduğu rafı okut"
                        disabled={kartKilitli}
                        className="w-full rounded-xl border border-neutral-200 px-3 py-3 pr-12 text-base focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900 disabled:bg-neutral-100 disabled:cursor-not-allowed"
                      />
                      {kartKilitli && (
                        <span className="absolute right-12 top-1/2 -translate-y-1/2 text-emerald-600 text-sm font-semibold">
                          ✓
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => openCamera('kaynakRafBarkodu')}
                        disabled={kartKilitli}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg hover:bg-neutral-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Kamerayı aç"
                      >
                        <svg
                          className="w-5 h-5 text-neutral-700"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z"
                          />
                        </svg>
                      </button>
                    </div>
                    {foundKaynakRaf && (
                      <div className="mt-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between mb-1">
                          <div className="font-semibold text-emerald-900">{foundKaynakRaf.RafAdi || foundKaynakRaf.raf_adi || ''}</div>
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                            (foundKaynakRaf.RafTipi || foundKaynakRaf.raf_tipi) === 'NORMAL' ? 'bg-neutral-100 text-neutral-700' :
                            (foundKaynakRaf.RafTipi || foundKaynakRaf.raf_tipi) === 'MAL_KABUL' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {(foundKaynakRaf.RafTipi || foundKaynakRaf.raf_tipi) === 'NORMAL' ? 'Normal Raf' :
                             (foundKaynakRaf.RafTipi || foundKaynakRaf.raf_tipi) === 'MAL_KABUL' ? 'Mal Kabul' :
                             (foundKaynakRaf.RafTipi || foundKaynakRaf.raf_tipi) === 'CIKIS' ? 'Çıkış' : (foundKaynakRaf.RafTipi || foundKaynakRaf.raf_tipi)}
                          </span>
                        </div>
                        <div className="text-xs text-emerald-700">Kod: {foundKaynakRaf.RafKodu || foundKaynakRaf.raf_kodu || kaynakRafBarkodu}</div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); setAktifKart(1); }}
                      className="h-10 w-10 rounded-full border border-neutral-300 text-lg font-semibold text-neutral-700 hover:bg-neutral-100 flex items-center justify-center touch-manipulation relative z-10"
                      title="Geri"
                      aria-label="Geri"
                    >
                      ←
                    </button>
                    {kaynakRafBarkodu.trim() && (
                      <button
                        type="button"
                        onClick={() => {
                          setKartKilitli(true);
                          setAktifKart(3);
                        }}
                        className="h-10 w-10 rounded-full border border-neutral-300 text-lg font-semibold text-neutral-700 hover:bg-neutral-100 flex items-center justify-center"
                        title="İleri"
                      >
                        →
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Transfer - Sayfa 3: Ürün Barkodu (Tekrar) */}
              <div ref={(el) => (slideRefs.current[2] = el)} className="w-full flex-shrink-0 px-1">
                <div className="space-y-2 rounded-2xl border-2 border-neutral-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-neutral-600"> 3. ADIM</div>
                      <h3 className="text-lg font-bold text-neutral-900">📦 ÜRÜN BARKODU (TEKRAR)</h3>
                    </div>
                    {urunTekrarOkutuldu && (
                      <span className="text-emerald-600 text-xl">✔️</span>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wide text-neutral-600">Ürün Barkodu</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={urunTekrarBarkod}
                        onChange={(e) => {
                          setUrunTekrarBarkod(e.target.value);
                          setCameraEnabled(false);
                        }}
                        placeholder="Ürünü tekrar okut"
                        disabled={urunTekrarOkutuldu}
                        className="w-full rounded-xl border border-neutral-200 px-3 py-3 pr-12 text-base focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900 disabled:bg-neutral-100 disabled:cursor-not-allowed"
                      />
                      {urunTekrarOkutuldu && (
                        <span className="absolute right-12 top-1/2 -translate-y-1/2 text-emerald-600 text-sm font-semibold">
                          ✓
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => openCamera('urunTekrarBarkod')}
                        disabled={urunTekrarOkutuldu}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg hover:bg-neutral-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Kamerayı aç"
                      >
                        <svg
                          className="w-5 h-5 text-neutral-700"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z"
                          />
                        </svg>
                      </button>
                    </div>
                    {foundProduct && (
                      <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-3 py-2 text-sm">
                        <div className="text-xs text-neutral-600 mb-1">Aynı ürünü tekrar okutun:</div>
                        <div className="font-semibold text-neutral-900">{foundProduct.name}</div>
                        <div className="text-xs text-neutral-700">Kod: {foundProduct.code} • Barkod: {manual}</div>
                      </div>
                    )}
                    {urunTekrarBarkod.trim() && !urunTekrarOkutuldu && foundProduct && (
                      <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                        Ürün eşleşmedi. Aynı ürünü okutun.
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); setKartKilitli(false); setAktifKart(2); }}
                      className="h-10 w-10 rounded-full border border-neutral-300 text-lg font-semibold text-neutral-700 hover:bg-neutral-100 flex items-center justify-center touch-manipulation relative z-10"
                      title="Geri"
                      aria-label="Geri"
                    >
                      ←
                    </button>
                    {urunTekrarOkutuldu && (
                      <button
                        type="button"
                        onClick={() => setAktifKart(4)}
                        className="h-10 w-10 rounded-full border border-neutral-300 text-lg font-semibold text-neutral-700 hover:bg-neutral-100 flex items-center justify-center"
                        title="İleri"
                      >
                        →
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Transfer - Sayfa 4: Hedef Raf Barkodu */}
              <div ref={(el) => (slideRefs.current[3] = el)} className="w-full flex-shrink-0 px-1">
                <div className="space-y-2 rounded-2xl border-2 border-neutral-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-neutral-600"> 4. ADIM</div>
                      <h3 className="text-lg font-bold text-neutral-900">📍 HEDEF RAF BARKODU</h3>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wide text-neutral-600">Hedef Raf Barkodu</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={hedefRafBarkodu}
                        onChange={(e) => {
                          setHedefRafBarkodu(e.target.value);
                          setCameraEnabled(false);
                        }}
                        placeholder="Bırakılacak rafı okut"
                        className="w-full rounded-xl border border-neutral-200 px-3 py-3 pr-12 text-base focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
                      />
                      <button
                        type="button"
                        onClick={() => openCamera('hedefRafBarkodu')}
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
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z"
                          />
                        </svg>
                      </button>
                    </div>
                    {foundHedefRaf && (
                      <div className="mt-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between mb-1">
                          <div className="font-semibold text-emerald-900">{foundHedefRaf.RafAdi || foundHedefRaf.raf_adi || ''}</div>
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                            (foundHedefRaf.RafTipi || foundHedefRaf.raf_tipi) === 'NORMAL' ? 'bg-neutral-100 text-neutral-700' :
                            (foundHedefRaf.RafTipi || foundHedefRaf.raf_tipi) === 'MAL_KABUL' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {(foundHedefRaf.RafTipi || foundHedefRaf.raf_tipi) === 'NORMAL' ? 'Normal Raf' :
                             (foundHedefRaf.RafTipi || foundHedefRaf.raf_tipi) === 'MAL_KABUL' ? 'Mal Kabul' :
                             (foundHedefRaf.RafTipi || foundHedefRaf.raf_tipi) === 'CIKIS' ? 'Çıkış' : (foundHedefRaf.RafTipi || foundHedefRaf.raf_tipi)}
                          </span>
                        </div>
                        <div className="text-xs text-emerald-700">Kod: {foundHedefRaf.RafKodu || foundHedefRaf.raf_kodu || hedefRafBarkodu}</div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-start pt-1">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); setAktifKart(3); }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      className="h-10 w-10 rounded-full border border-neutral-300 text-lg font-semibold text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200 flex items-center justify-center touch-manipulation relative z-20 shrink-0"
                      title="Geri"
                      aria-label="Geri"
                    >
                      ←
                    </button>
                  </div>
                </div>
              </div>
                </>
              ) : (
                <>
              {/* Giriş/Çıkış - Sayfa 1: Ürün Barkodu */}
              <div ref={(el) => (slideRefs.current[0] = el)} className="w-full flex-shrink-0 px-1">
                <div className="space-y-2 rounded-2xl border-2 border-neutral-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-neutral-600"> 1. ADIM</div>
                      <h3 className="text-lg font-bold text-neutral-900">📦 ÜRÜN BARKODU</h3>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wide text-neutral-600">ÜRÜN BARKODU</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={manual}
                        onChange={(e) => {
                          setManual(e.target.value);
                          setCameraEnabled(false);
                        }}
                        placeholder="Barkod girin"
                        className="w-full rounded-xl border border-neutral-200 px-3 py-3 pr-12 text-base focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
                      />
                      {valid && foundProduct && (
                        <span className="absolute right-12 top-1/2 -translate-y-1/2 text-emerald-600 text-sm font-semibold">
                          ✓
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => openCamera('barkod')}
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
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z"
                          />
                        </svg>
                      </button>
                    </div>
                    {foundProduct && !passiveWarning && (
                      <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700 space-y-0.5">
                        <div className="font-semibold text-emerald-900 text-sm">{foundProduct.name}</div>
                        {urunRafStoklari.length > 0 && urunRafStoklari.map((r) => (
                          <div key={r.rafKodu || r.rafAdi}>{r.rafAdi || r.rafKodu || 'Raf'} {r.adet} {foundProduct?.olcuBirimi || 'adet'}</div>
                        ))}
                      </div>
                    )}
                    {foundProduct && passiveWarning && (
                      <div className="rounded-xl bg-orange-50 border border-orange-200 px-3 py-2 text-sm">
                        <div className="font-semibold text-orange-900">{foundProduct.name}</div>
                        <div className="text-xs text-orange-700">Kod: {foundProduct.code}</div>
                        <div className="mt-2 flex items-center gap-2 text-xs text-orange-800 font-semibold">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <span>Bu ürün pasif durumdadır! Stok hareketi yapılamaz.</span>
                        </div>
                      </div>
                    )}
                    {manual.trim().length >= 6 && !foundProduct && !passiveWarning && (
                      <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
                        Bu barkoda ait ürün bulunamadı
                      </div>
                    )}
                    {passiveWarning && !foundProduct && (
                      <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
                        Bu ürün pasif olduğu için kullanılamamaktır
                      </div>
                    )}
                  </div>

                  {foundProduct && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setAktifKart(2)}
                        className="h-10 w-10 rounded-full border border-neutral-300 text-lg font-semibold text-neutral-700 hover:bg-neutral-100 flex items-center justify-center"
                        title="İleri"
                      >
                        →
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Giriş/Çıkış - Sayfa 2: Raf Barkodu */}
              <div ref={(el) => (slideRefs.current[1] = el)} className="w-full flex-shrink-0 px-1">
                <div className="space-y-2 rounded-2xl border-2 border-neutral-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-neutral-600"> 2. ADIM</div>
                      <h3 className="text-lg font-bold text-neutral-900">📦 RAF BARKODU</h3>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wide text-neutral-600">Raf Barkodu</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={rafBarkodu}
                        onChange={(e) => {
                          setRafBarkodu(e.target.value);
                          setCameraEnabled(false);
                        }}
                        placeholder="Raf barkodu girin veya kamerayı kullanın"
                        className="w-full rounded-xl border border-neutral-200 px-3 py-3 pr-12 text-base focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
                      />
                      <button
                        type="button"
                        onClick={() => openCamera('rafBarkodu')}
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
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z"
                          />
                        </svg>
                      </button>
                    </div>
                    {foundRaf && (
                      <div className="mt-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-semibold text-emerald-900">{foundRaf.RafAdi}</div>
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                            foundRaf.RafTipi === 'NORMAL' ? 'bg-neutral-100 text-neutral-700' :
                            foundRaf.RafTipi === 'MAL_KABUL' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {foundRaf.RafTipi === 'NORMAL' ? 'Normal Raf' :
                             foundRaf.RafTipi === 'MAL_KABUL' ? 'Mal Kabul' :
                             foundRaf.RafTipi === 'CIKIS' ? 'Çıkış' : foundRaf.RafTipi}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-start">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); setAktifKart(1); }}
                      className="h-10 w-10 rounded-full border border-neutral-300 text-lg font-semibold text-neutral-700 hover:bg-neutral-100 flex items-center justify-center touch-manipulation relative z-10"
                      title="Geri"
                      aria-label="Geri"
                    >
                      ←
                    </button>
                  </div>
                </div>
              </div>
                </>
              )}
            </div>
          </div>
        )}
        </div>

        {(islemTuru === 'giris' || islemTuru === 'cikis') && (
          <div className="space-y-1 mt-1">
            <label className="text-xs uppercase tracking-wide text-neutral-600">Miktar</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleAdjust(-1)}
                className="h-9 w-9 rounded-full border border-neutral-300 text-base font-semibold text-neutral-700 hover:bg-neutral-100 flex items-center justify-center shrink-0"
              >
                –
              </button>
              <input
                type="text"
                inputMode="numeric"
                value={miktar}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || /^\d+$/.test(val)) {
                    setMiktar(val);
                  }
                }}
                placeholder="0"
                className="flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-base text-center focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
              />
              <button
                type="button"
                onClick={() => handleAdjust(1)}
                className="h-9 w-9 rounded-full border border-neutral-300 text-base font-semibold text-neutral-700 hover:bg-neutral-100 flex items-center justify-center shrink-0"
              >
                +
              </button>
            </div>
          </div>
        )}

        {islemTuru === 'transfer' && (
          <div className="space-y-1 mt-1">
            <label className="text-xs uppercase tracking-wide text-neutral-600">Miktar</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleAdjust(-1)}
                className="h-9 w-9 rounded-full border border-neutral-300 text-base font-semibold text-neutral-700 hover:bg-neutral-100 flex items-center justify-center shrink-0"
              >
                –
              </button>
              <input
                type="text"
                inputMode="numeric"
                value={miktar}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || /^\d+$/.test(val)) {
                    setMiktar(val);
                  }
                }}
                placeholder="0"
                className="flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-base text-center focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
              />
              <button
                type="button"
                onClick={() => handleAdjust(1)}
                className="h-9 w-9 rounded-full border border-neutral-300 text-base font-semibold text-neutral-700 hover:bg-neutral-100 flex items-center justify-center shrink-0"
              >
                +
              </button>
            </div>
          </div>
        )}

        <div className="space-y-1 mt-1">
          <label className="text-xs uppercase tracking-wide text-neutral-600">Açıklama</label>
          <textarea
            value={aciklama}
            onChange={(e) => setAciklama(e.target.value)}
            rows={3}
            placeholder="Not ekleyin"
            className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
          />
        </div>

        {success && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800 mb-2">
            ✓ Stok hareketi başarıyla kaydedildi
          </div>
        )}
        {submitError && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 mb-2">
            {submitError}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 mt-3">
          <button
            type="button"
            onClick={onBack}
            className="flex-1 rounded-full border border-neutral-300 text-neutral-700 py-3 text-base font-semibold hover:bg-neutral-100"
          >
            İptal
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            className={`flex-1 rounded-full py-3 text-base font-semibold transition ${
              canSubmit ? 'bg-neutral-900 text-white hover:bg-neutral-800' : 'bg-neutral-200 text-neutral-500 cursor-not-allowed'
            }`}
            onClick={handleSubmit}
          >
            Kaydet
          </button>
        </div>
      </div>
    </section>
  );
}

