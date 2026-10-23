import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Guard: the Supabase URL/key are inlined into the bundle at build time. A
  // cloud build (Vercel/CI) has no .env file — if the project env vars are
  // missing, `vite build` would happily emit a bundle pointing at `undefined`
  // and every screen would fail at runtime. Fail the build instead.
  // `.env` locally and the dashboard env vars on Vercel both satisfy this.
  const env = loadEnv(mode, process.cwd(), '');
  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `missing env: ${missing.join(', ')} — add them to .env locally, or to the ` +
        `host's environment variables (Vercel → Settings → Environment Variables).`,
    );
  }

  return {
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
  };
});
