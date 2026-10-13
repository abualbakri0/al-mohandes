// db.mjs — طبقة تخزين موحّدة عبر Supabase (مع ذاكرة مؤقتة + بديل محلي)
// ============================================================
// الهدف: جعل بيانات البوت (الإعدادات/المشتركون/الإصدار) **دائمة** على أي
// استضافة سحابية (Railway) بدل الملفات المحلية المؤقتة التي تُمسح عند النشر.
//
// آلية العمل:
//   • init()   تُنادى مرة واحدة عند الإقلاع: تحمّل كل شيء من Supabase للذاكرة،
//              وترحّل البيانات المحلية الموجودة تلقائياً إن كانت Supabase فارغة.
//   • بعدها كل الدوال **متزامنة** تقرأ من الذاكرة (سريعة، بلا تأخير شبكة).
//   • الكتابة تُحدّث الذاكرة فوراً ثم تُرسل لـ Supabase بشكل متسلسل في الخلفية.
//
// التخزين في Supabase = جدول واحد bot_kv(key text pk, value jsonb):
//   'settings' | 'meta' | 'subscribers'
//
// إن لم يُضبط Supabase (لا URL/KEY) يعمل البوت على الملفات المحلية كما كان،
// وإن فشل الاتصال وقت الإقلاع يعود تلقائياً للملفات المحلية (عدم توقف البوت).

import { config } from './config.mjs';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const USE_DB = Boolean(config.supabaseUrl && config.supabaseKey);
const TABLE_URL = USE_DB ? `${config.supabaseUrl}/rest/v1/bot_kv` : null;

// هل الاتصال بـ Supabase ناجح؟ (يُحدَّث عند init)
let dbOnline = false;

// ذاكرة مؤقتة: المفتاح → القيمة (settings | meta | subscribers)
const cache = { settings: null, meta: null, subscribers: null };

// طابور كتابة متسلسل لضمان ترتيب الحفظ وعدم التضارب
let writeChain = Promise.resolve();

// ----------------- أدوات Supabase REST -----------------
async function rest(method, query, body, extraHeaders = {}) {
  const res = await fetch(`${TABLE_URL}?${query}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: config.supabaseKey,
      Authorization: `Bearer ${config.supabaseKey}`,
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function dbGet(key) {
  const rows = await rest('GET', `key=eq.${key}&select=value`);
  return rows && rows[0] ? rows[0].value : null;
}

async function dbSet(key, value) {
  await rest('POST', 'on_conflict=key', [{ key, value }], {
    Prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

// ----------------- أدوات محلية (fallback / ترحيل) -----------------
function localFile(key) {
  if (key === 'settings') return join(config.dataDir, 'settings.json');
  if (key === 'meta') return config.metaFile;
  if (key === 'subscribers') return config.subscribersFile;
  return null;
}

function localRead(file, fallback) {
  try {
    if (file && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`تعذّر قراءة ${file}:`, e.message);
  }
  return fallback;
}

function localWrite(file, data) {
  try {
    if (!existsSync(config.dataDir)) mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`تعذّر كتابة ${file}:`, e.message);
  }
}

// ----------------- التهيئة (تُنادى مرة عند الإقلاع) -----------------
export async function init() {
  // ابدأ بتحميل الملفات المحلية كقيمة ابتدائية/احتياطية
  cache.settings = localRead(localFile('settings'), null);
  cache.meta = localRead(localFile('meta'), null);
  cache.subscribers = localRead(localFile('subscribers'), null);

  if (!USE_DB) {
    console.log('ℹ️  Supabase غير مضبوط — استخدام التخزين المحلي.');
    return;
  }

  try {
    for (const key of ['settings', 'meta', 'subscribers']) {
      const remote = await dbGet(key);
      if (remote != null) {
        cache[key] = remote; // Supabase هو المصدر الموثوق
      } else if (cache[key] != null) {
        await dbSet(key, cache[key]); // ترحيل بيانات محلية موجودة
        console.log(`⬆️  تم ترحيل «${key}» المحلي إلى Supabase.`);
      }
    }
    dbOnline = true;
    console.log('🗄️  تم تحميل بيانات البوت من Supabase.');
  } catch (e) {
    dbOnline = false;
    console.error('⚠️  فشل الاتصال بـ Supabase، سيتم الاعتماد على الملفات المحلية:', e.message);
  }
}

// ----------------- واجهة متزامنة تقرأ من الذاكرة -----------------
export function getRaw(key) {
  return cache[key];
}

export function setRaw(key, value) {
  cache[key] = value; // تحديث فوري في الذاكرة (متزامن)
  const snapshot = value;
  writeChain = writeChain
    .then(async () => {
      if (dbOnline) {
        try {
          await dbSet(key, snapshot);
        } catch (e) {
          console.error(`فشل حفظ «${key}» في Supabase (حُفظ محلياً):`, e.message);
          localWrite(localFile(key), snapshot);
        }
      } else {
        localWrite(localFile(key), snapshot);
      }
    })
    .catch(() => { /* نتجاهل */ });
}

export function isDbOnline() {
  return dbOnline;
}
