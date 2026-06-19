import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During `npm run dev`, the React app runs on :5173 and the Zoho backend on :3000.
// This proxy forwards /api and /assets calls to the backend so login + data work.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/assets': 'http://localhost:3000',
    },
  },
  build: {
    // Production build outputs to public/ so the Node server serves it directly
    outDir: 'dist',
  },
});
