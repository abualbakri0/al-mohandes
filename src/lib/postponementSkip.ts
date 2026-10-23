// ============================================================
// سجل التأجيلات المحلية (Postponement Skip-List) — طبقة تخطي فقط.
// - لا يمس DB/RLS/جلسات/تشفير/عرض إشعارات.
// - عند وصول إشعار "تأجيل" لمحاضرة (مادة + يوم + وقت)، تُحفظ بصمة
//   تلك الحصة بالذات في localStorage.
// - جدولة المنبهات (useLectureReminders) تتخطى أي حصة مطابقة للبصمة:
//   تلك الحصة المستهدفة فقط — دون المساس بباقي محاضرات اليوم
//   أو الجدول الأسبوعي للأيام القادمة.
// - البصمات تُنظّف تلقائياً بعد 8 أيام (نافذة الجدولة القصوى).
// ============================================================

const SKIP_KEY = 'mohanndes_postponed_lectures_v1';
const SKIP_TTL_MS = 8 * 24 * 3600 * 1000; // 8 أيام = نافذة الجدولة + هامش

export type PostponedLecture = {
  subject: string; // اسم المادة (مطبّع)
  day: string; // اليوم العربي (مثل 'الثلاثاء')
  startTime: string; // 'HH:MM'
  savedAt: number; // طابع الحفظ (للتنظيف التلقائي)
};

/** تطبيع نصي للمقارنة (إزالة مسافات/تشكيل زائد، توحيد الوقت). */
export function normArabic(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/[ً-ٰٟ]/g, '') // إزالة التشكيل
    .replace(/\s+/g, ' ')
    .trim();
}

function normTime(t: string | null | undefined): string {
  if (!t) return '';
  const m = String(t).match(/(\d{1,2}):(\d{2})/);
  if (!m) return String(t).trim();
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function readSkipList(): PostponedLecture[] {
  try {
    const raw = localStorage.getItem(SKIP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    const fresh = (parsed as PostponedLecture[]).filter(
      (e) => e && typeof e.subject === 'string' && now - (e.savedAt ?? 0) < SKIP_TTL_MS,
    );
    return fresh;
  } catch {
    return [];
  }
}

function writeSkipList(list: PostponedLecture[]): void {
  try {
    localStorage.setItem(SKIP_KEY, JSON.stringify(list.slice(-50))); // حد أقصى 50 بصمة
  } catch { /* ignore */ }
}

/** بصمة حصة محاضرة — للمقارنة الدقيقة (مادة + يوم + وقت البدء). */
export function lectureFingerprint(subject: string, day: string, startTime: string): string {
  return `${normArabic(subject)}|${normArabic(day)}|${normTime(startTime)}`;
}

/**
 * تسجيل محاضرة مؤجلة (تُستدعى عند استلام إشعار تأجيل).
 * تُحفظ البصمة فقط — لا يُلغى أي منبه قائم هنا (الجدولة تتخطاها).
 */
export function markLecturePostponed(subject: string, day: string, startTime: string): void {
  if (!subject || !day || !startTime) return;
  const list = readSkipList();
  const fp = lectureFingerprint(subject, day, startTime);
  const exists = list.some(
    (e) => lectureFingerprint(e.subject, e.day, e.startTime) === fp,
  );
  if (exists) return;
  list.push({ subject: normArabic(subject), day: normArabic(day), startTime: normTime(startTime), savedAt: Date.now() });
  writeSkipList(list);
}

/**
 * هل هذه الحصة مؤجلة (يجب تخطي منبهها)؟
 * مطابقة دقيقة: نفس المادة + نفس اليوم + نفس وقت البدء فقط.
 */
export function isLecturePostponed(subject: string, day: string, startTime: string): boolean {
  if (!subject || !day || !startTime) return false;
  const fp = lectureFingerprint(subject, day, startTime);
  const list = readSkipList();
  let dirty = false;
  const now = Date.now();
  const fresh = list.filter((e) => {
    const ok = e && typeof e.subject === 'string' && now - (e.savedAt ?? 0) < SKIP_TTL_MS;
    if (!ok) dirty = true;
    return ok;
  });
  if (dirty) writeSkipList(fresh);
  return fresh.some((e) => lectureFingerprint(e.subject, e.day, e.startTime) === fp);
}
export type ParsedPostponement = { subject: string; day: string; startTime: string; };

export function parsePostponement(title: string, message: string): ParsedPostponement | null {
  try {
    const text = `${title ?? ''}\n${message ?? ''}`;
    const clean = normArabic(text);
    const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
    let day: string | null = null;
    for (const d of DAYS) {
      if (clean.includes(d)) { day = d === 'الاثنين' ? 'الإثنين' : d; break; }
    }
    if (!day) return null;
    const tm = clean.match(/(\d{1,2}):(\d{2})/);
    if (!tm) return null;
    const startTime = `${tm[1].padStart(2, '0')}:${tm[2]}`;
    let subject: string | null = null;
    const subjMatch = clean.match(/(?:محاضرة|مادة|تأجيل)\s+([^يوم]{2,40}?)(?:\s*(?:يوم|الساعة|\d{1,2}:|$))/);
    if (subjMatch) subject = subjMatch[1].replace(/^(تم|تأجيل|محاضرة|مادة|في|إلى|الى)\s+/g, '').trim();
    if (!subject || subject.length < 2) {
      // The `u` flag is required so the emoji (surrogate pairs) are treated as
      // single code points — without it ESLint reports a misleading character
      // class and each surrogate is stripped separately.
      const t = normArabic(title).replace(/[🚨🔔]/gu, '').replace(/(تأجيل|تم تأجيل|محاضرة|مادة)/g, '').trim();
      if (t.length >= 2 && t.length <= 40) subject = t;
    }
    if (!subject || subject.length < 2) return null;
    return { subject, day, startTime };
  } catch {
    return null;
  }
}

