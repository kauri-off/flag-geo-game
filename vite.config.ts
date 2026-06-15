import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Fully offline build: everything (map TopoJSON, flag SVGs, locale data) is
// bundled at build time. No runtime network requests.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Dev-only: forward the Online tab's gRPC-Web calls to the local game server
    // so the browser only ever talks to this same origin (mirrors the production
    // reverse-proxy subpath in server/README.md). Enter "/flaggame" as the server
    // URL in the Online tab. The prefix is stripped before proxying to :8080.
    proxy: {
      '/flaggame': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/flaggame/, ''),
      },
    },
  },
  preview: { host: '0.0.0.0', port: 4173 },
});
