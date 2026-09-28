import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { addProduct as addProductLocal, isBarcodeExists, isCodeExists, addProductActivity } from './storage';
import { addProduct as addProductAPI } from './api';
import { broadcastMessage } from './broadcastChannel';
import { sanitizeString, sanitizeHTML } from './sanitize';

export default function ProductForm({ onBack, aktifFirma }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState('');
  const [critical, setCritical] = useState('');
  const [price, setPrice] = useState('');
  const [desc, setDesc] = useState('');
  const [status, setStatus] = useState('active');
  const [olcuBirimi, setOlcuBirimi] = useState('adet');
  const [errors, setErrors] = useState({});
  const [cameraOn, setCameraOn] = useState(false);
  const [devices, setDevices] = useState([]);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [scanError, setScanError] = useState('');
  const [success, setSuccess] = useState(false);
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const controlsRef = useRef(null);

  const requiredFilled = code.trim() && name.trim() && barcode.trim() && critical.trim() && price.trim();

  const validate = () => {
    const next = {};
    if (!code.trim()) next.code = 'Bu alan zorunlu';
    else if (isCodeExists(code, null, aktifFirma)) next.code = 'Bu ürün kodu zaten kullanılıyor';
    
    if (!name.trim()) next.name = 'Bu alan zorunlu';
    
    if (!barcode.trim()) next.barcode = 'Bu alan zorunlu';
    else if (isBarcodeExists(barcode, null, aktifFirma)) next.barcode = 'Bu barkod zaten kullanılıyor';
    
    if (!critical.trim()) next.critical = 'Bu alan zorunlu';
    else if (Number(critical) < 0) next.critical = 'Kritik stok 0 veya pozitif olmalı';
    
    if (!price.trim()) next.price = 'Bu alan zorunlu';
    else if (Number(price) < 0) next.price = 'Fiyat 0 veya pozitif olmalı';
    
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    
    try {
      // Input'ları temizle (XSS koruması)
      const cleanedData = {
        code: sanitizeString(code),
        name: sanitizeString(name),
        barcode: sanitizeString(barcode),
        critical: sanitizeString(critical),
        price: sanitizeString(price),
        desc: sanitizeHTML(desc), // Açıklama alanı HTML içerebilir
        status,
        olcuBirimi: sanitizeString(olcuBirimi)
      };
      
      // API'ye temizlenmiş veriyi gönder
      const response = await addProductAPI(cleanedData);
      
      if (response.success || response.data) {
        // Başarılı - formu temizle
        setSuccess(true);
        setCode('');
        setName('');
        setBarcode('');
        setCritical('');
        setPrice('');
        setDesc('');
        setStatus('active');
        setOlcuBirimi('adet');
        setErrors({});
        
        // Diğer sayfalara ve tab'lara veri güncellemesi bildir
        broadcastMessage('product-added', { code: cleanedData.code, name: cleanedData.name });
        
        // Başarı mesajını 3 saniye sonra kaldır
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setErrors({ submit: response.message || 'Ürün kaydedilemedi. Lütfen tekrar deneyin.' });
      }
    } catch (err) {
      // Ürün kaydedilemedi
      setErrors({ submit: err.message || 'Ürün kaydedilemedi. Lütfen tekrar deneyin.' });
    }
  };

  useEffect(() => {
    return () => stopScan();
  }, []);

  useEffect(() => {
    if (cameraOn) {
      startScan();
    } else {
      stopScan();
    }
    return () => stopScan();
  }, [cameraOn, deviceIndex]);

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
            setBarcode(text);
            setCameraOn(false);
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
      setCameraOn(false);
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

  const openCamera = () => setCameraOn(true);
  const closeCamera = () => setCameraOn(false);
  const switchCamera = () => {
    if (!devices.length) return;
    const next = (deviceIndex + 1) % devices.length;
    setDeviceIndex(next);
    setCameraOn(false);
    setTimeout(() => setCameraOn(true), 50);
  };

  return (
    <section className="space-y-6" aria-label="Ürün Ekle">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-900">Ürün Ekle</h2>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-neutral-700 underline underline-offset-4"
        >
          Menüye dön
        </button>
      </div>

      <div className="space-y-4">
        <Field
          label="Ürün Kodu"
          value={code}
          onChange={setCode}
          error={errors.code}
          placeholder="Kod"
          info="Ürüne ait benzersiz kod"
        />
        <Field
          label="Ürün Adı"
          value={name}
          onChange={setName}
          error={errors.name}
          placeholder="Ad"
        />
        <BarcodeField
          label="Barkod"
          value={barcode}
          onChange={(val) => {
            setBarcode(val);
            setCameraOn(false);
          }}
          error={errors.barcode}
          onScan={openCamera}
          cameraOn={cameraOn}
          videoRef={videoRef}
          onCloseCamera={closeCamera}
          onSwitchCamera={switchCamera}
          devices={devices}
          scanError={scanError}
          info="Ürünü okutmak için kullanılacak ana barkod"
        />
        <Field
          label="Kritik Stok"
          value={critical}
          onChange={setCritical}
          error={errors.critical}
          placeholder="0"
          type="number"
          info="Bu değerin altına düşerse uyarı verir"
        />
        <Field
          label="Fiyat (TL)"
          value={price}
          onChange={setPrice}
          error={errors.price}
          placeholder="0.00"
          type="number"
          info="Ürünün birim fiyatı"
        />
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-neutral-600">Ölçü Birimi</div>
          <div className="relative">
            <select
              value={olcuBirimi}
              onChange={(e) => setOlcuBirimi(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900 appearance-none bg-white pr-8"
            >
              <option value="adet">Adet</option>
              <option value="m">Metre (m)</option>
              <option value="mm">Milimetre (mm)</option>
              <option value="kg">Kilogram (kg)</option>
              <option value="gr">Gram (gr)</option>
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg className="w-4 h-4 text-neutral-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-neutral-600">Durum</div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-neutral-700">Pasif</span>
            <button
              type="button"
              onClick={() => setStatus(status === 'active' ? 'passive' : 'active')}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                status === 'active' ? 'bg-emerald-600' : 'bg-neutral-300'
              }`}
            >
              <span
                className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  status === 'active' ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-sm text-neutral-700">Aktif</span>
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-neutral-600">Açıklama</div>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={3}
            placeholder="İsteğe bağlı açıklama"
            className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
          />
        </div>
      </div>

      {success && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
          ✓ Ürün başarıyla kaydedildi
        </div>
      )}
      {errors.submit && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          {errors.submit}
        </div>
      )}

      <button
        type="button"
        disabled={!requiredFilled}
        onClick={submit}
        className={`w-full rounded-full py-3 text-base font-semibold transition ${
          requiredFilled ? 'bg-neutral-900 text-white hover:bg-neutral-800' : 'bg-neutral-200 text-neutral-500 cursor-not-allowed'
        }`}
      >
        Kaydet
      </button>
    </section>
  );
}

function Field({ label, value, onChange, error, placeholder, type = 'text', info }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-neutral-600">
        <span>{label}</span>
        {info && <InfoHint text={info} />}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
      />
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}

function BarcodeField({ label, value, onChange, error, onScan, cameraOn, videoRef, onCloseCamera, onSwitchCamera, devices, scanError, info }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-neutral-600">
        <span>{label}</span>
        {info && <InfoHint text={info} />}
      </div>

      {cameraOn && (
        <div className="relative rounded-xl bg-neutral-100 aspect-[3/4] flex items-center justify-center text-neutral-500 overflow-hidden">
          <div className="absolute inset-6 border-2 border-emerald-500/60 rounded-xl pointer-events-none" />
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline autoPlay />
          <span className="absolute text-sm bg-black/60 text-white px-3 py-1 rounded-full">Kamera önizleme</span>
          <button
            type="button"
            onClick={onCloseCamera}
            className="absolute top-3 right-3 rounded-full bg-black/70 text-white px-3 py-1 text-xs"
          >
            Kamerayı Kapat
          </button>
          {onSwitchCamera && (
            <button
              type="button"
              onClick={onSwitchCamera}
              className="absolute top-3 left-3 rounded-full bg-black/70 text-white px-3 py-1 text-xs"
              disabled={!devices?.length}
            >
              Kamera Değiştir
            </button>
          )}
        </div>
      )}

      <div className="space-y-1">
        <div className="relative">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Barkod girin veya kamerayı kullanın"
            className="w-full rounded-xl border border-neutral-200 px-3 py-3 pr-12 text-base focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
          />
          <button
            type="button"
            onClick={onScan}
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
        {error && <div className="text-xs text-red-600">{error}</div>}
        <p className="text-xs text-neutral-500">Klavye veya barkod okuyucu ile girilebilir.</p>
      </div>
    </div>
  );
}

function InfoHint({ text }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(false);
    if (open) document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  const toggle = (e) => {
    e.stopPropagation();
    setOpen((p) => !p);
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        className="h-5 w-5 rounded-full border border-neutral-300 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-100"
      >
        ?
      </button>
      {open && (
        <div className="absolute z-10 mt-2 w-48 rounded-lg border border-neutral-200 bg-white p-2 text-[11px] text-neutral-700 shadow-sm">
          {text}
        </div>
      )}
    </div>
  );
}

