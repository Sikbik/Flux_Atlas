import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5391, strictPort: true, host: '127.0.0.1' },
  preview: { port: 5392, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 900 },
});
