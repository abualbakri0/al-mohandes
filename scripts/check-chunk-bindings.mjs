/**
 * فحص ربط القطع (chunk bindings) بعد التشويش.
 *
 * أهم خطر في تشويش ESM: تغيير أسماء التصدير فيكسر `import { x } from './chunk.js'`
 * وقت التشغيل فقط (لا يظهر في `tsc` ولا في الـminify). هذا السكربت يستخرج كل
 * استيراد من كل قطعة ويطابقه مع تصديرات القطعة الهدف.
 *
 * الاستخدام: node scripts/check-chunk-bindings.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'dist', 'assets');
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));

/** أسماء التصدير لكل ملف (export{a as b,c}) */
function exportsOf(code) {
  const names = new Set();
  for (const match of code.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const alias = part.trim().split(/\s+as\s+/).pop();
      if (alias) names.add(alias.trim());
    }
  }
  return names;
}

/** import{a as b,c}from"./x.js" و import"./x.js" */
function importsOf(code) {
  const out = [];
  for (const match of code.matchAll(/import\s*(?:\{([^}]*)\})?\s*from\s*["']\.\/([\w.-]+\.js)["']/g)) {
    const specifiers = (match[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+as\s+/)[0].trim());
    out.push({ target: match[2], specifiers });
  }
  return out;
}

const exportsByFile = new Map(files.map((f) => [f, exportsOf(readFileSync(join(dir, f), 'utf8'))]));
let problems = 0;
let checked = 0;

for (const file of files) {
  for (const { target, specifiers } of importsOf(readFileSync(join(dir, file), 'utf8'))) {
    const available = exportsByFile.get(target);
    if (!available) {
      console.error(`✗ ${file}: يستورد من ${target} وهو غير موجود`);
      problems += 1;
      continue;
    }
    for (const name of specifiers) {
      checked += 1;
      if (!available.has(name)) {
        console.error(`✗ ${file}: يستورد "${name}" من ${target} — غير مُصدَّر`);
        problems += 1;
      }
    }
  }
}

if (problems === 0) {
  console.log(`✓ ربط القطع سليم: ${checked} استيراداً مطابقاً في ${files.length} ملفاً`);
} else {
  console.error(`✗ ${problems} مشكلة ربط — الحزمة ستتعطّل وقت التشغيل`);
  process.exit(1);
}
