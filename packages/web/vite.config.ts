import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiPort = process.env.SDD_PORT ?? '4820';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.SDD_WEB_PORT ?? 4830),
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      '/ws': { target: `ws://127.0.0.1:${apiPort}`, ws: true },
    },
  },
});
