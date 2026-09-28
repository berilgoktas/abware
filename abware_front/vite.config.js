import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3002,
    https: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,      // Production'da tüm console.log'ları kaldır
        drop_debugger: true,     // Production'da debugger'ları kaldır
        pure_funcs: ['console.info', 'console.debug', 'console.warn'] // Bu fonksiyonları da kaldır
      }
    }
  }
})
