import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiPort = Number(process.env.SHORT_VIEWER_PORT || 4319);

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
      '/engine': `http://127.0.0.1:${apiPort}`,
      '/legacy': `http://127.0.0.1:${apiPort}`,
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
});
