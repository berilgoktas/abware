// Ürünler - localStorage kullanılmıyor, sadece state'te tutuluyor
export const getProducts = (firmaKodu) => {
  // localStorage kullanılmıyor, boş array döndür
  return [];
};

export const saveProducts = (products) => {
  // localStorage kullanılmıyor
  return true;
};

export const addProduct = (product, firmaKodu) => {
  // localStorage kullanılmıyor, sadece yeni ürün objesi döndür
  const newProduct = {
    id: Date.now(),
    code: product.code.trim(),
    name: product.name.trim(),
    barcode: product.barcode.trim(),
    criticalStock: Number(product.critical) || 0,
    desc: product.desc?.trim() || '',
    status: product.status || 'active',
    olcuBirimi: product.olcuBirimi || 'adet',
    totalIn: 0,
    totalOut: 0,
    stock: 0,
    firmaKodu: firmaKodu || '',
  };
  return newProduct;
};

export const updateProduct = (id, product, firmaKodu) => {
  // localStorage kullanılmıyor, sadece güncellenmiş ürün objesi döndür
  // Gerçek güncelleme state'te yapılacak
  return {
    id: id,
    code: product.code.trim(),
    name: product.name.trim(),
    barcode: product.barcode.trim(),
    criticalStock: Number(product.critical) || 0,
    desc: product.desc?.trim() || '',
    status: product.status || 'active',
    olcuBirimi: product.olcuBirimi || 'adet',
  };
};

export const getProductByBarcode = (barcode, firmaKodu) => {
  const products = getProducts(firmaKodu);
  return products.find((p) => p.barcode === barcode.trim());
};

export const getProductById = (id, firmaKodu) => {
  const products = getProducts(firmaKodu);
  return products.find((p) => p.id === id);
};

// Stok hareketleri - localStorage kullanılmıyor, sadece state'te tutuluyor
export const getMovements = (firmaKodu) => {
  // localStorage kullanılmıyor, boş array döndür
  return [];
};

export const saveMovements = (movements) => {
  // localStorage kullanılmıyor
  return true;
};

export const addMovement = (movement, firmaKodu, username = 'Bilinmeyen') => {
  // localStorage kullanılmıyor, sadece yeni hareket objesi döndür
  const newMovement = {
    id: Date.now(),
    productId: movement.productId,
    barcode: movement.barcode.trim(),
    type: movement.type, // 'giris' | 'cikis'
    amount: Number(movement.amount) || 0,
    description: movement.description?.trim() || '',
    timestamp: new Date().toISOString(),
    username: username,
    firmaKodu: firmaKodu || '',
  };
  return newMovement;
};

// Ürün ekleme/güncelleme aktivitesi kaydet
export const addProductActivity = (activity, firmaKodu, username = 'Bilinmeyen') => {
  // localStorage kullanılmıyor, sadece yeni aktivite objesi döndür
  const newActivity = {
    id: Date.now(),
    productId: activity.productId,
    barcode: activity.barcode || '',
    type: activity.type, // 'product_added' | 'product_updated'
    amount: 0,
    description: activity.description || '',
    timestamp: new Date().toISOString(),
    username: username,
    firmaKodu: firmaKodu || '',
    productName: activity.productName || '',
    productCode: activity.productCode || '',
  };
  return newActivity;
};

// Ürün stoklarını hesapla
export const calculateProductStocks = (firmaKodu) => {
  const products = getProducts(firmaKodu);
  const movements = getMovements(firmaKodu);

  return products.map((product) => {
    const productMovements = movements.filter((m) => m.productId === product.id);
    let totalIn = 0;
    let totalOut = 0;

    productMovements.forEach((m) => {
      if (m.type === 'giris') {
        totalIn += m.amount;
      } else if (m.type === 'cikis') {
        totalOut += m.amount;
      }
    });

    return {
      ...product,
      totalIn,
      totalOut,
      stock: totalIn - totalOut,
    };
  });
};

// Barkod veya kod kontrolü
export const isBarcodeExists = (barcode, excludeId = null, firmaKodu) => {
  const products = getProducts(firmaKodu);
  return products.some((p) => p.barcode === barcode.trim() && p.id !== excludeId);
};

export const isCodeExists = (code, excludeId = null, firmaKodu) => {
  const products = getProducts(firmaKodu);
  return products.some((p) => p.code === code.trim() && p.id !== excludeId);
};

// Kontrol paneli için yardımcı fonksiyonlar
export const getTodayMovements = (firmaKodu) => {
  const movements = getMovements(firmaKodu);
  const today = new Date().toDateString();
  
  return movements.filter((m) => {
    const movementDate = new Date(m.timestamp).toDateString();
    return movementDate === today;
  });
};

export const getCriticalProducts = (firmaKodu) => {
  const calculated = calculateProductStocks(firmaKodu);
  return calculated.filter((p) => p.stock < p.criticalStock);
};

export const getRecentMovements = (limit = 10, firmaKodu) => {
  const movements = getMovements(firmaKodu);
  const products = getProducts(firmaKodu);
  
  // En son hareketleri al ve sırala
  const sorted = [...movements].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  return sorted.slice(0, limit).map((m) => {
    const product = products.find((p) => p.id === m.productId);
    const date = new Date(m.timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    // Ürün ekleme/güncelleme/durum değişikliği aktiviteleri için özel işlem
    if (m.type === 'product_added' || m.type === 'product_updated' || m.type === 'product_status_changed') {
      let typeLabel = 'Ürün Güncellendi';
      let icon = 'edit';
      
      if (m.type === 'product_added') {
        typeLabel = 'Yeni Ürün Eklendi';
        icon = 'plus-box';
      } else if (m.type === 'product_status_changed') {
        typeLabel = m.description.includes('aktif') ? 'Ürün Aktifleştirildi' : 'Ürün Pasifleştirildi';
        icon = 'status-change';
      }
      
      return {
        id: m.id,
        name: m.productName || product?.name || 'Bilinmeyen Ürün',
        type: typeLabel,
        time: `${hours}:${minutes}`,
        date: `${day}.${month}.${year}`,
        icon: icon,
        adet: null,
        productId: m.productId,
        productCode: m.productCode,
        timestamp: m.timestamp,
        username: m.username || 'Bilinmeyen',
        description: m.description || '',
      };
    }
    
    return {
      id: m.id,
      name: product?.name || 'Bilinmeyen Ürün',
      type: m.type === 'giris' ? 'Giriş' : 'Çıkış',
      time: `${hours}:${minutes}`,
      date: `${day}.${month}.${year}`,
      icon: m.type === 'giris' ? 'plus' : 'minus',
      adet: m.amount,
      productId: m.productId,
      timestamp: m.timestamp,
      username: m.username || 'Bilinmeyen',
      description: m.description || '',
    };
  });
};

// Kullanıcı yönetimi - localStorage kullanılmıyor, sadece state'te tutuluyor
export const getUsers = (firmaKodu) => {
  // localStorage kullanılmıyor, boş array döndür
  return [];
};

export const saveUsers = (users) => {
  // localStorage kullanılmıyor
  return true;
};

export const addUser = (user, aktifFirmaKodu) => {
  // localStorage kullanılmıyor, sadece yeni kullanıcı objesi döndür
  const newUser = {
    id: Date.now(),
    name: user.username?.trim() || user.username.trim(), // name alanını username ile doldur (geriye uyumluluk için)
    username: user.username.trim(),
    password: user.password || '',
    role: user.role,
    permissions: user.permissions || [],
    status: user.status || 'active',
    firmaKodu: user.firmaKodu || aktifFirmaKodu || '',
  };
  return newUser;
};

export const updateUser = (id, userData, aktifFirmaKodu) => {
  // localStorage kullanılmıyor, sadece güncellenmiş kullanıcı objesi döndür
  // Gerçek güncelleme state'te yapılacak
  const updatedUser = {
    id: id,
    name: userData.username?.trim() || userData.name || '',
    username: userData.username?.trim() || '',
    role: userData.role,
    permissions: userData.permissions || [],
    status: userData.status || 'active',
    firmaKodu: userData.firmaKodu !== undefined ? userData.firmaKodu : aktifFirmaKodu || '',
  };
  
  // Şifre sadece yeni değer verilmişse güncelle
  if (userData.password !== undefined && userData.password !== '') {
    updatedUser.password = userData.password;
  }
  
  return updatedUser;
};

export const getUserById = (id) => {
  const users = getUsers();
  return users.find((u) => u.id === id);
};

export const getUserByUsername = (username) => {
  const users = getUsers();
  return users.find((u) => (u.username || u.name).toLowerCase() === username.trim().toLowerCase());
};

export const authenticateUser = (username, password, firmaKodu) => {
  // localStorage kullanılmıyor, kimlik doğrulama API üzerinden yapılacak
  // Bu fonksiyon artık kullanılmıyor, null döndür
  return null;
};

// Raf yönetimi - localStorage kullanılıyor
export const getRafs = (firmaKodu) => {
  try {
    const key = `abware-rafs-${firmaKodu || 'default'}`;
    const stored = localStorage.getItem(key);
    if (!stored) {
      return [];
    }
    return JSON.parse(stored);
  } catch (err) {
    return [];
  }
};

export const saveRafs = (rafs, firmaKodu) => {
  try {
    const key = `abware-rafs-${firmaKodu || 'default'}`;
    localStorage.setItem(key, JSON.stringify(rafs));
    return true;
  } catch (err) {
    return false;
  }
};

export const addRaf = (raf, firmaKodu) => {
  const rafs = getRafs(firmaKodu);
  const newRaf = {
    id: Date.now(),
    RafKodu: raf.RafKodu.trim(),
    RafAdi: raf.RafAdi.trim(),
    RafTipi: raf.RafTipi || 'NORMAL',
    Aktif: raf.Aktif !== undefined ? raf.Aktif : true,
    firmaKodu: firmaKodu || '',
  };
  rafs.push(newRaf);
  saveRafs(rafs, firmaKodu);
  return newRaf;
};

export const updateRaf = (id, raf, firmaKodu) => {
  const rafs = getRafs(firmaKodu);
  const index = rafs.findIndex((r) => r.id === id);
  if (index === -1) {
    return null;
  }
  rafs[index] = {
    ...rafs[index],
    RafKodu: raf.RafKodu.trim(),
    RafAdi: raf.RafAdi.trim(),
    RafTipi: raf.RafTipi || 'NORMAL',
    Aktif: raf.Aktif !== undefined ? raf.Aktif : true,
  };
  saveRafs(rafs, firmaKodu);
  return rafs[index];
};

export const deleteRaf = (id, firmaKodu) => {
  const rafs = getRafs(firmaKodu);
  const filtered = rafs.filter((r) => r.id !== id);
  saveRafs(filtered, firmaKodu);
  return true;
};

export const getRafById = (id, firmaKodu) => {
  const rafs = getRafs(firmaKodu);
  return rafs.find((r) => r.id === id);
};

export const isRafKoduExists = (rafKodu, excludeId = null, firmaKodu) => {
  const rafs = getRafs(firmaKodu);
  return rafs.some((r) => r.RafKodu === rafKodu.trim() && r.id !== excludeId);
};

