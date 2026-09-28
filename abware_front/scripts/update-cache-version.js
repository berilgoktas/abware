import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const swPath = join(__dirname, '..', 'public', 'sw.js');

try {
  // sw.js dosyasını oku
  let content = readFileSync(swPath, 'utf8');
  
  // CACHE_NAME satırını bul ve versiyon numarasını artır
  const versionRegex = /const CACHE_NAME = 'abware-cache-v(\d+)';/;
  const match = content.match(versionRegex);
  
  if (match) {
    const currentVersion = parseInt(match[1], 10);
    const newVersion = currentVersion + 1;
    const newCacheName = `const CACHE_NAME = 'abware-cache-v${newVersion}';`;
    
    // Versiyonu güncelle
    content = content.replace(versionRegex, newCacheName);
    
    // Dosyayı kaydet
    writeFileSync(swPath, content, 'utf8');
    
    console.log(`✅ Cache versiyonu güncellendi: v${currentVersion} → v${newVersion}`);
  } else {
    console.warn('⚠️  CACHE_NAME bulunamadı, versiyon güncellenemedi.');
  }
} catch (error) {
  console.error('❌ Hata:', error.message);
  process.exit(1);
}

