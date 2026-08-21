import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    // If you reverse-proxy the dev server behind a custom hostname, add it here
    // (Vite's default host check only allows localhost): allowedHosts: ['your.dev.hostname'],
    proxy: {
      '/ws': {
        target: 'ws://localhost:3002',
        ws: true,
      },
      '/api/auth': {
        target: 'http://localhost:3002',
        rewrite: (path) => path.replace(/^\/api\/auth/, '/auth'),
      },
      '/api': {
        target: 'http://localhost:3002',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
