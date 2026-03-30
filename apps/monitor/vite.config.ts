import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3002',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3002',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
