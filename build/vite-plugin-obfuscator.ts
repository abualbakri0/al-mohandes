/**
 * ============================================================================
 *  Vite Obfuscator Plugin — تشويش حزمة JavaScript في وضع الإنتاج
 * ============================================================================
 * لماذا؟
 *   تطبيق Capacitor يحمل حزمة الويب داخل الـAPK في `assets/public/assets/*.js`.
 *   أي شخص يفكّ ضغط الـAPK يقرأ الحزمة مباشرة. `minify: 'esbuild'` (المفعّل
 *   مسبقاً) يختصر الأسماء لكنه **يترك** كل النصوص الحرفية (أسماء جداول/RPC،
 *   رسائل، عناوين) وبنية المنطق كاملة.
 *   هذا المكوّن يضيف فوقه:
 *     • مخزن نصوص مشفّر (base64/rc4) + تدوير وتبديل الفهارس ⇒ لا `grep`
 *       على أي نص داخل الحزمة.
 *     • أسماء مُعرّفات سداسية بلا معنى.
 *     • (اختياري) selfDefending ⇒ تنسيق الكود يكسره، لكنه يستخدم eval
 *       فمعطّل افتراضياً: `vercel.json` يفرض CSP بدون 'unsafe-eval'.
 *     • disableConsoleOutput ⇒ لا تسريب تفاصيل.
 *
 * ما لا يفعله (حدود صريحة):
 *   • لا يخفي VITE_SUPABASE_URL / anon key (تُرسل في كل طلب HTTP أصلاً)؛
 *     حمايتهما = RLS + دالة الحافة (راجع SECURITY.md).
 *   • لا يخفي أسماء أصناف Tailwind في CSS.
 *   • لا يمنع تشغيل نسخة معدّلة — هذا دور R8 + بصمة التوقيع في MainActivity
 *     + Play Integrity (راجع docs/PLAY-INTEGRITY-PLAN.md).
 *
 * ضمانات التشغيل:
 *   • كل قطعة تُفحص نحوياً بـesbuild بعد التشويش؛ فشلها يُفشل البناء
 *     (fail-closed) بدل شحن حزمة معطوبة بصمت.
 *   • تعطيل كامل: OBFUSCATE=0
 *   • أقوى تحويل (flattening) معطّل افتراضياً: OBFUSCATE_CFF=1
 * ============================================================================
 */
import JavaScriptObfuscatorModule from 'javascript-obfuscator';
import type { ObfuscatorOptions } from 'javascript-obfuscator';
import { transformSync } from 'esbuild';
import type { OutputChunk, Plugin } from 'vite';

// الحزمة تُشحن كـCommonJS: import المسمّى يفشل داخل ESM، فالتفكيك من الافتراضي.
const { obfuscate } = JavaScriptObfuscatorModule as unknown as {
  obfuscate: (sourceCode: string, options: ObfuscatorOptions) => { getObfuscatedCode(): string };
};

const KIB = 1024;

export interface ObfuscatorPluginOptions {
  /** false ⇒ يُترك البناء كما هو (minify فقط). */
  enabled?: boolean;
  /** flattening لتقليل قابلية القراءة — يستهلك وقت بناء وأداء تشغيل. */
  controlFlowFlattening?: boolean;
  /**
   * يحوّل تنسيق الحزمة (beautify) إلى كسر فعلي، لكنه يستخدم `Function(...)`
   * = eval ⇒ **ممنوع** على الويب لأن `vercel.json` يفرض `script-src 'self'`
   * بلا `'unsafe-eval'`. فعّله فقط لبناء APK إن أردت.
   */
  selfDefending?: boolean;
  /** false ⇒ أي فشل تشويش يصبح تحذيراً ويُشحن الأصل (غير مستحسن). */
  strict?: boolean;
}

/**
 * إعدادات متدرّجة حسب حجم القطعة:
 *  • الصغيرة (منطق التطبيق) → rc4 للنصوص + تحويلات أكثر.
 *  • الكبيرة (vendor) → base64 فقط، لأن rc4 على كل وصول نص يُبطئ التشغيل
 *    بلا فائدة (كود مكتبات معروف مسبقاً للجميع).
 */
function buildOptions(
  sizeBytes: number,
  cff: boolean,
  selfDefending: boolean,
): ObfuscatorOptions {
  const big = sizeBytes > 400 * KIB;

  return {
    compact: true,
    target: 'browser',

    // ---- أسماء المُعرّفات ------------------------------------------------
    identifierNamesGenerator: 'hexadecimal',
    // إلزامي: أسماء التصدير/الاستيراد بين القطع (ESM) تُحلّ بالاسم وقت
    // التشغيل؛ تغييرها = تعطّل التطبيق فوراً.
    renameGlobals: false,
    // إلزامي: React/DOM/Capacitor تعتمد على أسماء خصائص نصية.
    renameProperties: false,

    // ---- النصوص: الطبقة الأهم -------------------------------------------
    stringArray: true,
    // 1.0 = كل النصوص تدخل المخزن المشفّر. 0.8 كان يترك 20% عشوائية مكشوفة
    // (قِيس فعلياً: عنوان المشروع ظهر مرة واحدة في أحد الإصدارات) — التغطية
    // الكاملة تكلّف ~10% حجماً إضافياً مقابل ضمان لا ثقوب فيه.
    stringArrayThreshold: 1,
    stringArrayEncoding: [big ? 'base64' : 'rc4'],
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayIndexShift: true,
    stringArrayIndexesType: ['hexadecimal-number'],
    // 1 غلاف فقط + بلا نداءات متسلسلة: كل غلاف إضافي يضاعف حجم كل وصول نص
    // (قِيس: ×2.59 بالحجم مع 2 — وهذا يخفضه إلى ~×2 بلا خسارة حماية تُذكر).
    stringArrayWrappersCount: 1,
    stringArrayWrappersType: 'function',
    stringArrayWrappersChainedCalls: false,
    // تقسيم النصوص الطويلة: يمنع مطابقة عنوان URL كامل بالبحث النصي.
    splitStrings: false,

    // ---- تحويلات بنائية -------------------------------------------------
    numbersToExpressions: false,
    simplify: true,
    controlFlowFlattening: cff,
    controlFlowFlatteningThreshold: cff ? 0.2 : 0,
    deadCodeInjection: false,
    // لا تلمس مفاتيح الكائنات: قد تُستخدم كخصائص DOM/React.
    transformObjectKeys: false,

    // ---- حماية ضد التحليل -----------------------------------------------
    // معطّل افتراضياً: يستخدم eval، و`vercel.json` يفرض CSP بلا unsafe-eval.
    // (لو فعّلته لحزمة APK فقط: OBFUSCATE_SELFDEF=1)
    selfDefending,
    // يضع حلقات debugger لا نهائية عند أدوات المطوّر؛ معطّل دائماً.
    debugProtection: false,
    disableConsoleOutput: true,
    unicodeEscapeSequence: false,

    sourceMap: false,
    // 0 = بذرة عشوائية كل بناء ⇒ بصمة مختلفة (لا مقارنة بين إصدارين).
    seed: 0,
  };
}

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

function isJsChunk(value: unknown): value is OutputChunk {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as OutputChunk).type === 'chunk' &&
    typeof (value as OutputChunk).code === 'string'
  );
}

export function viteObfuscator(options: ObfuscatorPluginOptions = {}): Plugin {
  const {
    enabled = true,
    controlFlowFlattening = false,
    selfDefending = false,
    strict = true,
  } = options;
  let logger: Logger | null = null;

  return {
    name: 'almohanndes:obfuscator',
    apply: 'build',
    // آخر خطوة دائماً: بعد التقطيع والـminify.
    enforce: 'post',

    configResolved(config) {
      logger = config.logger;
    },

    generateBundle(_outputOptions, bundle) {
      if (!enabled) {
        logger?.info('[obfuscator] skipped (OBFUSCATE=0)');
        return;
      }

      const chunks = Object.values(bundle)
        .filter(isJsChunk)
        .filter((chunk) => /\.m?js$/i.test(chunk.fileName));

      let beforeTotal = 0;
      let afterTotal = 0;
      const startedAt = Date.now();
      let done = 0;

      for (const chunk of chunks) {
        const original = chunk.code;
        const beforeBytes = Buffer.byteLength(original);
        beforeTotal += beforeBytes;
        const t0 = Date.now();

        let obfuscated: string;
        try {
          obfuscated = obfuscate(
            original,
            buildOptions(beforeBytes, controlFlowFlattening, selfDefending),
          ).getObfuscatedCode();
        } catch (error) {
          const message =
            `[obfuscator] فشل تشويش ${chunk.fileName}: ` +
            (error instanceof Error ? error.message : String(error));
          if (strict) {
            // fail-closed: لا نشحن حزمة نظنّها محمية وهي ليست كذلك.
            this.error(message);
            return;
          }
          logger?.warn(`${message} — يُشحن الأصل`);
          continue;
        }

        // فحص نحوي: التشويش يجب ألا يغيّر صلاحية الشيفرة.
        try {
          transformSync(obfuscated, { loader: 'js', target: 'es2020' });
        } catch (error) {
          const message =
            `[obfuscator] ناتج التشويش غير صالح نحوياً في ${chunk.fileName}: ` +
            (error instanceof Error ? error.message : String(error));
          if (strict) {
            this.error(message);
            return;
          }
          logger?.warn(`${message} — يُشحن الأصل`);
          continue;
        }

        chunk.code = obfuscated;
        const afterBytes = Buffer.byteLength(obfuscated);
        afterTotal += afterBytes;
        done += 1;

        logger?.info(
          `[obfuscator] ${chunk.fileName}  ${Math.round(beforeBytes / KIB)}KB → ` +
            `${Math.round(afterBytes / KIB)}KB  ${Date.now() - t0}ms`,
        );
      }

      if (done > 0) {
        const ratio = (afterTotal / Math.max(beforeTotal, 1)).toFixed(2);
        logger?.info(
          `[obfuscator] ${done}/${chunks.length} قطعة في ${Date.now() - startedAt}ms ` +
            `(${Math.round(beforeTotal / KIB)}KB → ${Math.round(afterTotal / KIB)}KB, ×${ratio})`,
        );
      }
    },
  };
}
