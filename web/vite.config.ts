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
      rolldownOptions: {
        output: {
          // One long-lived vendor chunk. Left alone, Rolldown cuts the libraries every page needs into a dozen
          // small eager fragments named after whichever module imports them, and its hash then moves with the
          // app's own code. Here the libraries the shell always loads are pinned to one chunk with a fixed name
          // and nothing but node_modules in it, so it fetches once, compresses as one file, and keeps its hash
          // until one of these packages (or the part of it the app uses) changes. Left out on purpose: lucide-react
          // (the icons in use change with the UI), three (the globe's own lazy chunk) and the app's code.
          codeSplitting: {
            groups: [
              {
                name: 'vendor',
                test: /node_modules[\\/](react|react-dom|scheduler|@tanstack|zustand|use-sync-external-store)[\\/]/,
              },
            ],
          },
        },
      },
    },
  };
});
