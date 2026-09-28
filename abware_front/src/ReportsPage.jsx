import { useState, useEffect } from 'react';
import { getUsers as getUsersAPI, downloadPersonnelReport, downloadStockReport } from './api';

function ReportsPage({ onBack }) {
  const [stokTariheGoreSec, setStokTariheGoreSec] = useState(false);
  const [stokBaslangicTarihi, setStokBaslangicTarihi] = useState('2026-01-01');
  const [stokBitisTarihi, setStokBitisTarihi] = useState('2026-01-31');
  const [personelBaslangicTarihi, setPersonelBaslangicTarihi] = useState('2026-01-01');
  const [personelBitisTarihi, setPersonelBitisTarihi] = useState('2026-01-31');
  const [seciliPersonel, setSeciliPersonel] = useState('');
  const [personeller, setPersoneller] = useState([]);
  const [stokRaporLoading, setStokRaporLoading] = useState(false);
  const [personelRaporLoading, setPersonelRaporLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadPersoneller();
  }, []);

  const loadPersoneller = async () => {
    try {
      const response = await getUsersAPI();
      let usersArray = null;
      
      if (Array.isArray(response)) {
        usersArray = response;
      } else if (response && response.data) {
        if (Array.isArray(response.data)) {
          usersArray = response.data;
        } else if (response.data.kullanicilar && Array.isArray(response.data.kullanicilar)) {
          usersArray = response.data.kullanicilar;
        } else if (response.data.users && Array.isArray(response.data.users)) {
          usersArray = response.data.users;
        }
      }
      
      if (usersArray && usersArray.length > 0) {
        const formatted = usersArray.map((user) => ({
          id: user.Id || user.id,
          adSoyad: user.AdSoyad || user.ad_soyad || user.name || user.KullaniciAdi || user.kullanici_adi || '',
          kullaniciAdi: user.KullaniciAdi || user.kullanici_adi || user.username || '',
        }));
        setPersoneller(formatted);
      }
    } catch (err) {
      console.error('Personeller yüklenemedi:', err);
      setPersoneller([]);
    }
  };

  const handleStokRaporIndir = async () => {
    if (stokTariheGoreSec) {
      if (!stokBaslangicTarihi || !stokBitisTarihi) return;
      if (new Date(stokBitisTarihi) < new Date(stokBaslangicTarihi)) {
        setError('Bitiş tarihi başlangıç tarihinden önce olamaz.');
        return;
      }
    }
    setStokRaporLoading(true);
    setError('');
    setSuccess('');
    try {
      const baslangic = stokTariheGoreSec ? stokBaslangicTarihi : null;
      const bitis = stokTariheGoreSec ? stokBitisTarihi : null;
      const result = await downloadStockReport(baslangic, bitis);
      if (result.success) {
        setSuccess('Stok raporu başarıyla indirildi!');
        setTimeout(() => setSuccess(''), 3000);
      }
    } catch (err) {
      setError(err.message || 'Rapor indirilemedi. Lütfen tekrar deneyin.');
    } finally {
      setStokRaporLoading(false);
    }
  };

  const handlePersonelRaporIndir = async () => {
    if (!personelBaslangicTarihi || !personelBitisTarihi) return;
    if (new Date(personelBitisTarihi) < new Date(personelBaslangicTarihi)) {
      setError('Bitiş tarihi başlangıç tarihinden önce olamaz.');
      return;
    }
    setPersonelRaporLoading(true);
    setError('');
    setSuccess('');
    try {
      const result = await downloadPersonnelReport(seciliPersonel, personelBaslangicTarihi, personelBitisTarihi);
      if (result.success) {
        setSuccess('Personel raporu başarıyla indirildi!');
        setTimeout(() => setSuccess(''), 3000);
      }
    } catch (err) {
      setError(err.message || 'Rapor indirilemedi. Lütfen tekrar deneyin.');
    } finally {
      setPersonelRaporLoading(false);
    }
  };

  const stokRaporAktif = !stokTariheGoreSec || (stokBaslangicTarihi && stokBitisTarihi && new Date(stokBitisTarihi) >= new Date(stokBaslangicTarihi));
  const personelRaporAktif = personelBaslangicTarihi && personelBitisTarihi && new Date(personelBitisTarihi) >= new Date(personelBaslangicTarihi);

  return (
    <section className="space-y-4" aria-label="Raporlar">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-neutral-900">Raporlar</h2>
          <p className="text-sm text-neutral-500">Excel formatında rapor indirin</p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-neutral-700 underline underline-offset-4"
        >
          Menüye dön
        </button>
      </div>

      {/* Hata/Başarı Mesajları */}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
          ✓ {success}
        </div>
      )}

      {/* Stok Raporu Kartı */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-neutral-700" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-neutral-900">Stok Raporu</h3>
            <p className="text-xs text-neutral-500">Tarih aralığına göre stok hareketleri</p>
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={stokTariheGoreSec}
            onChange={(e) => setStokTariheGoreSec(e.target.checked)}
            className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
          />
          <span className="text-sm text-neutral-700">Tarihe göre seç</span>
        </label>

        {stokTariheGoreSec && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-neutral-600">Başlangıç</label>
              <input
                type="date"
                value={stokBaslangicTarihi}
                onChange={(e) => setStokBaslangicTarihi(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-neutral-600">Bitiş</label>
              <input
                type="date"
                value={stokBitisTarihi}
                onChange={(e) => setStokBitisTarihi(e.target.value)}
                min={stokBaslangicTarihi}
                className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleStokRaporIndir}
          disabled={!stokRaporAktif || stokRaporLoading}
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-full font-semibold transition ${
            stokRaporAktif && !stokRaporLoading
              ? 'bg-neutral-900 text-white hover:bg-neutral-800'
              : 'bg-neutral-200 text-neutral-500 cursor-not-allowed'
          }`}
        >
          {stokRaporLoading ? (
            <span>Hazırlanıyor...</span>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Raporu İndir
            </>
          )}
        </button>
      </div>

      {/* Personel Bazlı Rapor Kartı */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-neutral-700" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-neutral-900">Personel Bazlı Rapor</h3>
            <p className="text-xs text-neutral-500">Personel ve tarih aralığına göre</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-wide text-neutral-600">Personel</label>
            <select
              value={seciliPersonel}
              onChange={(e) => setSeciliPersonel(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900 bg-white"
            >
              <option value="">Personel seçin</option>
              {personeller.map((personel) => (
                <option key={personel.id} value={personel.id}>
                  {personel.adSoyad || personel.kullaniciAdi}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-neutral-600">Başlangıç</label>
              <input
                type="date"
                value={personelBaslangicTarihi}
                onChange={(e) => setPersonelBaslangicTarihi(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-neutral-600">Bitiş</label>
              <input
                type="date"
                value={personelBitisTarihi}
                onChange={(e) => setPersonelBitisTarihi(e.target.value)}
                min={personelBaslangicTarihi}
                className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900"
              />
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handlePersonelRaporIndir}
          disabled={!personelRaporAktif || personelRaporLoading}
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-full font-semibold transition ${
            personelRaporAktif && !personelRaporLoading
              ? 'bg-neutral-900 text-white hover:bg-neutral-800'
              : 'bg-neutral-200 text-neutral-500 cursor-not-allowed'
          }`}
        >
          {personelRaporLoading ? (
            <span>Hazırlanıyor...</span>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Raporu İndir
            </>
          )}
        </button>
      </div>
    </section>
  );
}

export default ReportsPage;
