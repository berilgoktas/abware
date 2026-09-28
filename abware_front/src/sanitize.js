import DOMPurify from 'dompurify';

/**
 * String inputları temizle - Hiçbir HTML tag'ine izin verme
 * XSS saldırılarını engellemek için kullan
 */
export const sanitizeString = (input) => {
  if (typeof input !== 'string') return input;
  return DOMPurify.sanitize(input.trim(), { 
    ALLOWED_TAGS: [], // Hiçbir HTML tag'i izin verme
    ALLOWED_ATTR: [] 
  });
};

/**
 * HTML içeren inputları temizle - Sadece güvenli temel HTML tag'lerine izin ver
 * Açıklama alanları için kullan
 */
export const sanitizeHTML = (input) => {
  if (typeof input !== 'string') return input;
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'br', 'p'], // Sadece basit formatlamaya izin ver
    ALLOWED_ATTR: []
  });
};

/**
 * Tüm form data'sını temizle
 * Object içindeki tüm string değerleri sanitize eder
 */
export const sanitizeFormData = (data) => {
  const cleaned = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      cleaned[key] = sanitizeString(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      cleaned[key] = sanitizeFormData(value); // Nested objects için recursive
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
};

/**
 * URL'leri temizle ve validate et
 * Sadece http/https protokollerine izin ver
 */
export const sanitizeURL = (url) => {
  if (typeof url !== 'string') return '';
  
  try {
    const parsed = new URL(url);
    // Sadece http ve https protokollerine izin ver
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return DOMPurify.sanitize(url);
    }
    return '';
  } catch (e) {
    // Geçersiz URL
    return '';
  }
};

/**
 * Sayısal inputları temizle ve validate et
 */
export const sanitizeNumber = (input, { min = null, max = null, allowDecimal = true } = {}) => {
  if (typeof input === 'number') return input;
  
  const cleaned = sanitizeString(String(input));
  const parsed = allowDecimal ? parseFloat(cleaned) : parseInt(cleaned, 10);
  
  if (isNaN(parsed)) return 0;
  
  if (min !== null && parsed < min) return min;
  if (max !== null && parsed > max) return max;
  
  return parsed;
};

