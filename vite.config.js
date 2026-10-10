import { defineConfig } from 'vite';

// A new id every build, added to the URLs of the big data files (terrain heights) so a headset never uses an old cached copy.
const BUILD_ID = Date.now().toString(36);

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  base: './',
  server: { host: '0.0.0.0', port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
