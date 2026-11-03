import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL('../../dist/renderer', import.meta.url)), emptyOutDir: true, target: 'chrome120' },
  server: { port: 5173, strictPort: true },
});
