import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const apiTarget = process.env.WORA_API_TARGET ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/zustand/')) return 'vendor';
          if (id.includes('/node_modules/socket.io-client/')) return 'socket';
          if (id.includes('/node_modules/lucide-react/')) return 'icons';
          return undefined;
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app'],
    proxy: {
      '/api':       { target: apiTarget, changeOrigin: true },
      '/health':    { target: apiTarget, changeOrigin: true },
      '/ready':     { target: apiTarget, changeOrigin: true },
      '/socket.io': { target: apiTarget, ws: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app'],
    proxy: {
      '/api':       { target: apiTarget, changeOrigin: true },
      '/health':    { target: apiTarget, changeOrigin: true },
      '/ready':     { target: apiTarget, changeOrigin: true },
      '/socket.io': { target: apiTarget, ws: true },
    },
  },
});
