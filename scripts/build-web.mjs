/**
 * بناء بديل بلا تشويش — للتشخيص فقط.
 *
 * لماذا سكربت بدل `vite build` مباشرة؟
 *   npm على Windows لا يستطيع ضبط متغيّر بيئة داخل السكربت (`OBFUSCATE=0 vite build`
 *   صيغة Unix فقط)، فكان الحل سكربت صغير يضبطه ثم ينادي Vite.
 *
 * الاستخدام:  npm run build:nobf
 */
import { build } from 'vite';

if (process.argv.includes('--no-obfuscate')) {
  process.env.OBFUSCATE = '0';
}

await build({ mode: 'production' });
