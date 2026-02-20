import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:7770',
      '/v1': 'http://localhost:7770',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
