import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 4788 },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
  },
});
