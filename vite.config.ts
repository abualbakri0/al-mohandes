import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { viteObfuscator } from './build/vite-plugin-obfuscator';

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

  // ---------------------------------------------------------------------
  // تشويش الحزمة (Anti-reverse-engineering) — مفعّل افتراضياً في الإنتاج.
  //   OBFUSCATE=0        ⇒ بناء عادي (للتشخيص فقط)
  //   OBFUSCATE_CFF=1    ⇒ + control-flow flattening (أقوى، أبطأ، أعلى خطورة)
  //   OBFUSCATE_STRICT=0 ⇒ فشل التشويش يصبح تحذيراً بدل إفشال البناء
  // ---------------------------------------------------------------------
  const obfuscate = mode === 'production' && process.env.OBFUSCATE !== '0';

  return {
    base: './',
    plugins: [
      react(),
      viteObfuscator({
        enabled: obfuscate,
        controlFlowFlattening: process.env.OBFUSCATE_CFF === '1',
        // eval-based: لا يُفعَّل على الويب (CSP: script-src 'self' بلا unsafe-eval).
        selfDefending: process.env.OBFUSCATE_SELFDEF === '1',
        strict: process.env.OBFUSCATE_STRICT !== '0',
      }),
    ],
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
      // Minify first (fast, removes whitespace/names), then the obfuscator
      // plugin above runs as the LAST step and encrypts the string table.
      minify: 'esbuild',
      cssMinify: true,
      reportCompressedSize: false,
      // التشويش يكبّر الحزمة (~×2.2) — الحد مُرفَع لتفادي تحذير مضلّل.
      chunkSizeWarningLimit: 1600,
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
