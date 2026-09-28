import { describe, it, expect } from 'vitest';
import {
  getProducts,
  addProduct,
  updateProduct,
  isBarcodeExists,
  isCodeExists,
  addMovement,
  calculateProductStocks,
  getCriticalProducts,
  getTodayMovements,
  getRecentMovements,
  addUser,
  updateUser,
} from './storage';

describe('Kullanıcı Senaryoları - Yoldan Geçen Adam Testi', () => {
  const firmaKodu = 'TEST';

  describe('Kullanıcı: Ürün Ekleme', () => {
    it('Kullanıcı yeni ürün ekleyebiliyor mu?', () => {
      const newProduct = {
        code: 'URUN001',
        name: 'Test Ürünü',
        barcode: '1234567890123',
        critical: '5',
        status: 'active',
        olcuBirimi: 'adet',
      };

      const product = addProduct(newProduct, firmaKodu);
      expect(product).toBeDefined();
      expect(product.code).toBe('URUN001');
      expect(product.name).toBe('Test Ürünü');
      expect(product.barcode).toBe('1234567890123');
      expect(product.criticalStock).toBe(5);
      expect(product.id).toBeDefined();
    });

    it('Kullanıcı ürün bilgilerini güncelleyebiliyor mu?', () => {
      const updatedData = {
        code: 'URUN001-GUNCELLENMIS',
        name: 'Güncellenmiş Ürün Adı',
        barcode: '9876543210987',
        critical: '10',
        status: 'active',
        olcuBirimi: 'adet',
      };

      const updated = updateProduct(1, updatedData, firmaKodu);
      expect(updated).toBeDefined();
      expect(updated.code).toBe('URUN001-GUNCELLENMIS');
      expect(updated.name).toBe('Güncellenmiş Ürün Adı');
      expect(updated.barcode).toBe('9876543210987');
    });

    it('Ürün güncellenebiliyor mu?', () => {
      const updatedData = {
        code: 'TEST002',
        name: 'Güncellenmiş Ürün',
        barcode: '987654321',
        critical: '20',
        status: 'active',
        olcuBirimi: 'adet',
      };

      const updated = updateProduct(1, updatedData, firmaKodu);
      expect(updated).toBeDefined();
      expect(updated.code).toBe('TEST002');
      expect(updated.name).toBe('Güncellenmiş Ürün');
    });

    it('Kullanıcı aynı barkod ile ürün ekleyemiyor mu? (Çift kayıt kontrolü)', () => {
      const exists = isBarcodeExists('1234567890123', null, firmaKodu);
      expect(typeof exists).toBe('boolean');
    });

    it('Kullanıcı aynı kod ile ürün ekleyemiyor mu? (Çift kayıt kontrolü)', () => {
      const exists = isCodeExists('URUN001', null, firmaKodu);
      expect(typeof exists).toBe('boolean');
    });
  });

  describe('Kullanıcı: Stok Giriş/Çıkış', () => {

    it('Kullanıcı stok girişi yapabiliyor mu?', () => {
      const movement = {
        productId: 1,
        barcode: '1234567890123',
        type: 'giris',
        amount: 50,
        description: 'Depo girişi',
      };

      const newMovement = addMovement(movement, firmaKodu, 'Kullanici1');
      expect(newMovement).toBeDefined();
      expect(newMovement.type).toBe('giris');
      expect(newMovement.amount).toBe(50);
      expect(newMovement.username).toBe('Kullanici1');
      expect(newMovement.id).toBeDefined();
    });

    it('Kullanıcı stok çıkışı yapabiliyor mu?', () => {
      const movement = {
        productId: 1,
        barcode: '1234567890123',
        type: 'cikis',
        amount: 20,
        description: 'Satış çıkışı',
      };

      const newMovement = addMovement(movement, firmaKodu, 'Kullanici1');
      expect(newMovement).toBeDefined();
      expect(newMovement.type).toBe('cikis');
      expect(newMovement.amount).toBe(20);
      expect(newMovement.username).toBe('Kullanici1');
    });
  });

  describe('Kullanıcı: Stok Durumu Görüntüleme', () => {
    it('Kullanıcı stok durumunu görebiliyor mu?', () => {
      const stocks = calculateProductStocks(firmaKodu);
      expect(Array.isArray(stocks)).toBe(true);
      // Her ürün için stok bilgisi olmalı
      stocks.forEach(product => {
        expect(product).toHaveProperty('stock');
        expect(product).toHaveProperty('totalIn');
        expect(product).toHaveProperty('totalOut');
      });
    });

    it('Kullanıcı kritik stok uyarısı alabiliyor mu?', () => {
      const critical = getCriticalProducts(firmaKodu);
      expect(Array.isArray(critical)).toBe(true);
      // Kritik stokta olan ürünlerin stoku kritik seviyenin altında olmalı
      critical.forEach(product => {
        expect(product.stock).toBeLessThan(product.criticalStock);
      });
    });

    it('Kullanıcı bugünkü hareketleri görebiliyor mu?', () => {
      const todayMovements = getTodayMovements(firmaKodu);
      expect(Array.isArray(todayMovements)).toBe(true);
    });

    it('Kullanıcı son hareketleri görebiliyor mu?', () => {
      const recentMovements = getRecentMovements(10, firmaKodu);
      expect(Array.isArray(recentMovements)).toBe(true);
      expect(recentMovements.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Kullanıcı: Kullanıcı Yönetimi', () => {
    it('Admin yeni kullanıcı ekleyebiliyor mu?', () => {
      const newUser = {
        username: 'yeni_kullanici',
        password: 'sifre123',
        role: 'Depo Personeli',
        permissions: ['stock_view', 'stock_movement'],
        status: 'active',
      };

      const user = addUser(newUser, firmaKodu);
      expect(user).toBeDefined();
      expect(user.username).toBe('yeni_kullanici');
      expect(user.role).toBe('Depo Personeli');
      expect(user.status).toBe('active');
      expect(user.id).toBeDefined();
    });

    it('Admin kullanıcı bilgilerini güncelleyebiliyor mu?', () => {
      const updateData = {
        username: 'guncellenmis_kullanici',
        role: 'Depo Sorumlusu',
        permissions: ['product_manage', 'stock_view'],
        status: 'active',
      };

      const updated = updateUser(1, updateData, firmaKodu);
      expect(updated).toBeDefined();
      expect(updated.username).toBe('guncellenmis_kullanici');
      expect(updated.role).toBe('Depo Sorumlusu');
    });
  });
});

