/**
 * Dev server config — run via `/dev start dtm-monitor`
 * Port 5181 | Proxies to production backend at :3002
 */
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5181,
    host: true,
    allowedHosts: true,
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
