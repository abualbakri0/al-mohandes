import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  // Security: never emit source maps in production (they expose the exact
  // original source of the app to anyone who downloads the bundle).
  build: {
    sourcemap: false,
    // Max JS obfuscation via the existing bundler: full minification,
    // no legal comments, no beautification — unreadable in F12.
    minify: 'esbuild',
    cssMinify: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 600,
  },
  // Security: strip console.* and `debugger` from production bundles so
  // diagnostics/error details can't be read by anyone inspecting the app.
  // Dev mode keeps console output (only removes stray `debugger` statements).
  esbuild:
    mode === 'production'
      ? { drop: ['console', 'debugger'] }
      : { drop: ['debugger'] },
}));
