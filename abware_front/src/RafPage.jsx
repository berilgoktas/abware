import { useState, useEffect } from 'react';
import { getRafs as getRafsAPI, getRafStok, addRaf as addRafAPI, updateRaf as updateRafAPI, deleteRaf as deleteRafAPI } from './api';

// JSON escape karakterlerini decode et
const decodeMessage = (message) => {
  if (!message) return message;
  try {
    // JSON string formatındaki escape karakterlerini decode et
    return JSON.parse(`"${message}"`);
  } catch {
    // Eğer parse edilemezse direkt döndür
    return message;
  }
};

export default function RafPage({ onBack, aktifFirma }) {
  const [rafs, setRafs] = useState([]);
  const [allRafs, setAllRafs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRafModal, setShowRafModal] = useState(false);
  const [editingRaf, setEditingRaf] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('Tüm Raflar');
  const [rafForm, setRafForm] = useState({
    RafKodu: '',
    RafAdi: '',
    RafTipi: 'NORMAL',
    Aktif: true,
  });
  const [rafFormError, setRafFormError] = useState('');
  const [selectedRaf, setSelectedRaf] = useState(null);
  const [rafUrunler, setRafUrunler] = useState([]);
  const [loadingRafUrunler, setLoadingRafUrunler] = useState(false);

  // Raf listesini yükle
  useEffect(() => {
    loadRafs();
  }, []);

  const loadRafs = async () => {
    try {
      setLoading(true);
      const response = await getRafsAPI();
      if (response.success && response.data) {
        // API'den gelen tum_raflar array'ini kullan
        const allRafsData = response.data.tum_raflar || [];
        // API formatını frontend formatına çevir
        const formattedRafs = allRafsData.map((raf) => ({
          id: raf.Id,
          RafKodu: raf.RafKodu,
          RafAdi: raf.RafAdi,
          RafTipi: raf.RafTipi,
          Aktif: raf.Aktif,
        }));
        setAllRafs(formattedRafs);
        filterRafs(formattedRafs, searchQuery, activeTab);
      }
    } catch (err) {
      console.error('Raf listesi yüklenemedi:', err);
    } finally {
      setLoading(false);
    }
  };

  const filterRafs = (rafsToFilter, query, tab) => {
    let filtered = [...rafsToFilter];

    // Sekme filtresi
    if (tab !== 'Tüm Raflar') {
      const tipMap = {
        'Normal': 'NORMAL',
        'Mal Kabul': 'MAL_KABUL',
        'Çıkış': 'CIKIS',
      };
      filtered = filtered.filter((raf) => raf.RafTipi === tipMap[tab]);
    }

    // Arama filtresi
    if (query.trim()) {
      const lowerQuery = query.toLowerCase();
      filtered = filtered.filter(
        (raf) =>
          raf.RafKodu.toLowerCase().includes(lowerQuery) ||
          raf.RafAdi.toLowerCase().includes(lowerQuery)
      );
    }

    setRafs(filtered);
  };

  useEffect(() => {
    if (allRafs.length > 0) {
      filterRafs(allRafs, searchQuery, activeTab);
    }
  }, [searchQuery, activeTab, allRafs]);

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

  const handleRafClick = async (raf) => {
    setSelectedRaf(raf);
    setRafUrunler([]);
    setLoadingRafUrunler(true);
    try {
      const response = await getRafStok(raf.id);
      const data = response?.data;
      const list = data?.stok ?? [];
      const arr = Array.isArray(list) ? list : [];
      const items = arr.map((u) => ({
        ad: u.UrunAdi ?? '',
        kod: u.UrunKodu ?? '',
        adet: Number(u.Adet ?? 0),
        birim: 'adet',
      }));
      setRafUrunler(items);
    } catch (err) {
      setRafUrunler([]);
    } finally {
      setLoadingRafUrunler(false);
    }
  };

  const handleCloseRafUrunler = () => {
    setSelectedRaf(null);
    setRafUrunler([]);
  };

  // Raf yönetimi fonksiyonları
  const handleOpenRafModal = (raf = null) => {
    if (raf) {
      setEditingRaf(raf);
      setRafForm({
        RafKodu: raf.RafKodu,
        RafAdi: raf.RafAdi,
        RafTipi: raf.RafTipi,
        Aktif: raf.Aktif,
      });
    } else {
      setEditingRaf(null);
      setRafForm({
        RafKodu: '',
        RafAdi: '',
        RafTipi: 'NORMAL',
        Aktif: true,
      });
    }
    setRafFormError('');
    setShowRafModal(true);
  };

  const handleCloseRafModal = () => {
    setShowRafModal(false);
    setEditingRaf(null);
    setRafForm({
      RafKodu: '',
      RafAdi: '',
      RafTipi: 'NORMAL',
      Aktif: true,
    });
    setRafFormError('');
  };

  const handleSaveRaf = async () => {
    setRafFormError('');
    
    if (!rafForm.RafKodu.trim()) {
      setRafFormError('Raf kodu zorunludur');
      return;
    }
    
    if (!rafForm.RafAdi.trim()) {
      setRafFormError('Raf adı zorunludur');
      return;
    }

    try {
      let response;
      if (editingRaf) {
        // Güncelleme
        response = await updateRafAPI(editingRaf.id, rafForm);
      } else {
        // Yeni ekleme
        response = await addRafAPI(rafForm);
      }

      if (response.success) {
        // Listeyi yeniden yükle
        await loadRafs();
        handleCloseRafModal();
      } else {
        setRafFormError(response.message || 'Raf kaydedilemedi. Lütfen tekrar deneyin.');
      }
    } catch (err) {
      setRafFormError(err.message || 'Raf kaydedilemedi. Lütfen tekrar deneyin.');
    }
  };

  const handleDeleteRaf = async (raf) => {
    if (window.confirm('Bu rafı pasife almak istediğinize emin misiniz?')) {
      try {
        const response = await updateRafAPI(raf.id, {
          RafKodu: raf.RafKodu,
          RafAdi: raf.RafAdi,
          Aktif: false,
        });
        if (response.success) {
          // Listeyi yeniden yükle
          await loadRafs();
        } else {
          // API'den gelen hata mesajını göster
          const rawMessage = response.message || response.error?.message || 'Raf pasife alınamadı. Lütfen tekrar deneyin.';
          const errorMessage = decodeMessage(rawMessage);
          alert(errorMessage);
        }
      } catch (err) {
        // Hata mesajını decode et ve göster
        const rawMessage = err.message || 'Raf pasife alınamadı. Lütfen tekrar deneyin.';
        const errorMessage = decodeMessage(rawMessage);
        alert(errorMessage);
      }
    }
  };

  return (
    <section className="space-y-1" aria-label="Raf yönetimi">
      {!showRafModal && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-900">Raf Yönetimi</h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleOpenRafModal()}
                className="w-10 h-10 rounded-full bg-neutral-900 text-white flex items-center justify-center hover:bg-neutral-800 transition-colors"
                title="Yeni raf ekle"
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

          {/* Arama Çubuğu */}
          <div className="space-y-2">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Raf kodu / adı ara"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-neutral-200 bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
              />
            </div>
          </div>

          {/* Raf Listesi */}
          <div className="space-y-3">
            {loading ? (
              <div className="text-center py-12 text-neutral-600">
                Yükleniyor...
              </div>
            ) : rafs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-24 h-24 mb-4 flex items-center justify-center">
                  <svg className="w-full h-full text-neutral-300" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <p className="text-neutral-600 mb-4">Henüz raf eklenmemiş</p>
                <button
                  type="button"
                  onClick={() => handleOpenRafModal()}
                  className="px-6 py-3 bg-neutral-900 text-white rounded-lg font-medium hover:bg-neutral-800 transition-colors"
                >
                  Yeni Raf Ekle
                </button>
              </div>
            ) : (
              rafs.map((raf) => (
                <div
                  key={raf.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleRafClick(raf)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRafClick(raf); } }}
                  className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm cursor-pointer hover:border-neutral-300 hover:shadow-md transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-lg font-bold text-neutral-900">{raf.RafAdi}</h3>
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${getRafTipiColor(raf.RafTipi)}`}>
                          {getRafTipiLabel(raf.RafTipi)}
                        </span>
                      </div>
                      <p className="text-sm text-neutral-500">Kod: {raf.RafKodu}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-100" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleOpenRafModal(raf); }}
                      className="p-2 rounded-lg border border-neutral-300 text-neutral-700 text-xs font-medium hover:bg-neutral-50 transition-colors flex items-center justify-center gap-1.5 shrink-0"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Düzenle
                    </button>
                    {raf.Aktif && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteRaf(raf); }}
                        className="p-2 rounded-lg border border-red-300 text-red-700 text-xs font-medium hover:bg-red-50 transition-colors flex items-center justify-center gap-1.5 shrink-0"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Sil
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {showRafModal && (
        <div className="fixed inset-0 bg-black/25 flex items-start sm:items-center justify-center px-2 sm:px-4 py-2 sm:py-4 z-50 overflow-y-auto">
          <div className="w-full max-w-md bg-white border border-neutral-300 rounded-2xl shadow-lg my-auto max-h-[95vh] sm:max-h-[90vh] flex flex-col min-h-0">
            <div className="flex-shrink-0 p-4 sm:p-6 border-b border-neutral-200">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base sm:text-lg font-semibold text-neutral-900">
                  {editingRaf ? 'Raf Düzenle' : 'Yeni Raf Ekle'}
                </h3>
                <button
                  type="button"
                  onClick={handleCloseRafModal}
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
                    Raf Kodu *
                  </label>
                  <input
                    type="text"
                    value={rafForm.RafKodu}
                    onChange={(e) => setRafForm({ ...rafForm, RafKodu: e.target.value })}
                    placeholder="RAF-A1"
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs uppercase tracking-wide text-neutral-600">
                    Raf Adı *
                  </label>
                  <input
                    type="text"
                    value={rafForm.RafAdi}
                    onChange={(e) => setRafForm({ ...rafForm, RafAdi: e.target.value })}
                    placeholder="RAF-A1"
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs uppercase tracking-wide text-neutral-600">
                    Raf Tipi
                  </label>
                  <select
                    value={rafForm.RafTipi}
                    onChange={(e) => setRafForm({ ...rafForm, RafTipi: e.target.value })}
                    disabled={!!editingRaf}
                    className={`w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900 ${
                      editingRaf ? 'bg-neutral-100 cursor-not-allowed' : ''
                    }`}
                  >
                    <option value="NORMAL">NORMAL</option>
                    <option value="MAL_KABUL">MAL KABUL</option>
                    <option value="CIKIS">ÇIKIŞ</option>
                  </select>
                  {editingRaf && (
                    <p className="text-xs text-neutral-500 mt-1">Raf tipi değiştirilemez</p>
                  )}
                </div>

                {rafFormError && (
                  <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
                    {rafFormError}
                  </div>
                )}

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleCloseRafModal}
                    className="flex-1 rounded-full border border-neutral-300 text-neutral-700 py-2.5 sm:py-3 text-sm sm:text-base font-semibold hover:bg-neutral-50 transition-colors"
                  >
                    İptal
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveRaf}
                    className="flex-1 rounded-full bg-neutral-900 text-white py-2.5 sm:py-3 text-sm sm:text-base font-semibold hover:bg-neutral-800 transition-colors"
                  >
                    {editingRaf ? 'Güncelle' : 'Ekle'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedRaf && (
        <div className="fixed inset-0 bg-black/25 flex items-end sm:items-center justify-center z-50" onClick={handleCloseRafUrunler}>
          <div
            className="w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-lg max-h-[85vh] flex flex-col min-h-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-shrink-0 p-4 border-b border-neutral-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-neutral-900">{selectedRaf.RafAdi} – İçerik</h3>
              <button
                type="button"
                onClick={handleCloseRafUrunler}
                className="p-2 rounded-lg hover:bg-neutral-100 text-neutral-600"
                aria-label="Kapat"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 min-h-0 p-4 flex flex-col">
              {loadingRafUrunler ? (
                <div className="text-center py-8 text-neutral-500">Yükleniyor...</div>
              ) : rafUrunler.length === 0 ? (
                <div className="text-center py-8 text-neutral-500">Bu rafta ürün bulunmuyor</div>
              ) : (
                <div className={rafUrunler.length > 5 ? 'overflow-y-auto max-h-[20rem] min-h-0' : ''}>
                  <ul className="space-y-2">
                    {rafUrunler.map((item, index) => (
                      <li
                        key={index}
                        className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-neutral-50 border border-neutral-200"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-neutral-900 truncate">{item.ad || '—'}</div>
                          <div className="text-xs text-neutral-500">Kod: {item.kod || '—'}</div>
                        </div>
                        <div className="flex-shrink-0 ml-2 text-sm font-semibold text-neutral-700">
                          {item.adet} {item.birim}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
