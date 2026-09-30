import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// The Rust server (or `cargo run --example demo_server`) listens on 127.0.0.1:3000 by default.
// Override with ATLAS_API_TARGET=http://host:port (read from the shell or a .env file).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.ATLAS_API_TARGET || 'http://127.0.0.1:3000';
  const wsTarget = target.replace(/^http/, 'ws');
  const proxy = {
    '/api': { target, changeOrigin: false },
    '/ws': { target: wsTarget, ws: true, changeOrigin: false },
    '/healthz': { target, changeOrigin: false },
  };
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: Number(env.ATLAS_WEB_PORT || 5173),
      proxy,
    },
    preview: {
      host: '127.0.0.1',
      port: Number(env.ATLAS_WEB_PORT || 4173),
      proxy,
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      chunkSizeWarningLimit: 900,
    },
  };
});
