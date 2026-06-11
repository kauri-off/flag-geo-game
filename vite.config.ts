import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Fully offline build: everything (map TopoJSON, flag SVGs, locale data) is
// bundled at build time. No runtime network requests.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173 },
  preview: { host: '0.0.0.0', port: 4173 },
});
