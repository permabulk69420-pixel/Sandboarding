import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: '0.0.0.0', port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
