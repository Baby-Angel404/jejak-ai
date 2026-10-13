import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.API_URL ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Frontend tidak pernah memegang API key: semua panggilan lewat proxy ini ke backend.
    proxy: { '/api': { target, changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
});