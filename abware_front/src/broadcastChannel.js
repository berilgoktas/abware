// BroadcastChannel API ile farklı tab/window'lar arasında real-time mesajlaşma
const CHANNEL_NAME = 'abware-sync';

let channel = null;

// BroadcastChannel'ı başlat
const getChannel = () => {
  if (typeof BroadcastChannel === 'undefined') {
    // BroadcastChannel desteklenmiyorsa fallback olarak window event kullan
    return null;
  }
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
};

// Mesaj gönder (tüm tab/window'lara)
export const broadcastMessage = (type, data = {}) => {
  const ch = getChannel();
  if (ch) {
    ch.postMessage({ type, data, timestamp: Date.now() });
  }
  // Fallback: Aynı window içinde de event gönder
  window.dispatchEvent(new CustomEvent('abware-data-updated', { detail: { type, data } }));
};

// Mesaj dinle (tüm tab/window'lardan)
export const listenToMessages = (callback) => {
  const ch = getChannel();
  
  if (ch) {
    const handler = (event) => {
      callback(event.data);
    };
    ch.addEventListener('message', handler);
    
    // Cleanup fonksiyonu döndür
    return () => {
      ch.removeEventListener('message', handler);
    };
  } else {
    // Fallback: window event dinle
    const handler = (event) => {
      callback({ type: 'data-updated', data: event.detail?.data || {} });
    };
    window.addEventListener('abware-data-updated', handler);
    
    return () => {
      window.removeEventListener('abware-data-updated', handler);
    };
  }
};

// Channel'ı kapat (cleanup için)
export const closeChannel = () => {
  if (channel) {
    channel.close();
    channel = null;
  }
};

