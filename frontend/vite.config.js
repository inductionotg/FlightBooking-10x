import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const proxy = (port, prefix) => ({
  target: `http://[::1]:${port}`,
  changeOrigin: true,
  rewrite: path => path.replace(prefix, '')
});

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/backend/auth': proxy(3001, /^\/backend\/auth/),
      '/backend/flights': proxy(3002, /^\/backend\/flights/),
      '/backend/booking': proxy(3003, /^\/backend\/booking/)
    }
  }
});
