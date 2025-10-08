import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy API requests to backend in development
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/healthz': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
