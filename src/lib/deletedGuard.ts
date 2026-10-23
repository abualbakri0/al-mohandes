// ============================================================
// حارس المستخدم المحذوف (Deleted-User Guard) — طبقة فحص فقط.
// - لا يمس بنية قاعدة البيانات ولا سياسات RLS ولا دوال التشفير.
// - لا يمس نظام الإشعارات (لا عرض، لا اشتراك، لا قنوات).
// - مهمته: عند الثبوت القطعي للحذف (null مؤكد شبكياً):
//   1) حذف ارتباطات التوكن الخاصة بهذا الجهاز من السيرفر.
//   2) إلغاء المهام المجدولة محلياً.
// - أي timeout/خطأ/انقطاع = UNKNOWN = إبقاء كل شيء بصمت تام.
// ============================================================

import { supabase, type Registration } from '@/lib/supabase';
import { checkRegistration } from '@/lib/api';
import { getStoredPushToken, clearPushToken } from '@/lib/push';

const UNKNOWN = Symbol('deleted-guard-unknown');
type CheckResult = Registration | null | typeof UNKNOWN;

/** آخر فحص مؤكد (لمنع التكرار المفرط عند كل إشعار). */
let lastCheckAt = 0;
let lastCheckOutcome: 'valid' | 'deleted' | null = null;
const CHECK_THROTTLE_MS = 5 * 60_000; // 5 دقائق كحد أدنى بين فحصين مؤكدين
const CHECK_TIMEOUT_MS = 8_000;

function readStoredSession(): { phone: string } | null {
  try {
    const raw = localStorage.getItem('univ_user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { phone?: unknown };
    if (typeof parsed?.phone !== 'string' || !parsed.phone) return null;
    return { phone: parsed.phone };
  } catch {
    return null; // تخزين تالف → ليس حذفاً → لا نفعل شيئاً
  }
}

/** فحص وجود الحساب عبر نفس دالة التطبيق. null مؤكد = محذوف. */
export async function checkAccountExists(phone: string): Promise<CheckResult> {
  try {
    const raced = await Promise.race([
      checkRegistration(phone),
      new Promise<typeof UNKNOWN>((r) => setTimeout(() => r(UNKNOWN), CHECK_TIMEOUT_MS)),
    ]);
    return raced;
  } catch {
    return UNKNOWN;
  }
}

/** إبطال ارتباطات هذا الجهاز في السيرفر (fire-and-forget — لا ترمي أبداً).
 * المسار الأول: DELETE المباشر (يعمل عندما تسمح سياسات RLS).
 * المسار الثاني (احتياطي، متوافق مع سياسات الإنتاج المشددة التي تمنع
 * DELETE من العميل): UPDATE alerts_enabled=false — دالة push-notify
 * في السيرفر تتخطى أي صف معطّل، فيتوقف وصول الإشعارات فوراً لنفس النتيجة.
 * لا يعدّل أي سياسة — يستخدم فقط العمليات المسموحة أصلاً (DELETE/UPDATE).
 */
export function invalidateDeviceLinks(): void {
  let token: string | null = null;
  try {
    token = getStoredPushToken();
  } catch {
    token = null;
  }
  clearPushToken(); // محلي أولاً (متزامن) لمنع أي re-upload متسابق
  if (token) {
    const doomed = token;
    void (async () => {
      try {
        // المسار الأول: RPC محصّن (يعمل بعد إغلاق SELECT على الجدول).
        const rpc = await supabase.rpc('unregister_push_token', { p_token: doomed });
        if (!rpc.error) return; // حُذف — انتهى
        // DELETE المباشر (يعمل عندما تسمح سياسات RLS — قاعدة قديمة).
        const r = await supabase.from('push_tokens').delete().eq('token', doomed);
        if (!r.error) return; // حُذف — انتهى
        // DELETE مرفوض من السياسات → عطّل الصف بدل حذفه (نفس الأثر).
        const u = await supabase
          .from('push_tokens')
          .update({ alerts_enabled: false, last_seen_at: new Date().toISOString() })
          .eq('token', doomed);
        if (u.error) console.warn('[deleted-guard] push token disable failed', u.error.message);
      } catch (e) {
        console.warn('[deleted-guard] push token delete failed', e);
      }
    })();
  }
  void (async () => {
    try {
      if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      const endpoint = sub?.endpoint;
      if (!endpoint) return;
      try { await sub?.unsubscribe(); } catch { /* ignore */ }
      // RPC محصّن أولاً (الحذف بفلتر ممنوع بعد إغلاق SELECT).
      const wrpc = await supabase.rpc('unregister_web_push', { p_endpoint: endpoint });
      if (!wrpc.error) return;
      const r = await supabase.from('web_push_subscriptions').delete().eq('endpoint', endpoint);
      if (!r.error) return;
      const u = await supabase
        .from('web_push_subscriptions')
        .update({ alerts_enabled: false, last_seen_at: new Date().toISOString() })
        .eq('endpoint', endpoint);
      if (u.error) console.warn('[deleted-guard] webpush disable failed', u.error.message);
    } catch (e) {
      console.warn('[deleted-guard] webpush delete failed', e);
    }
  })();
}

/** إلغاء المهام المجدولة محلياً على هذا الجهاز (fire-and-forget). */
export function cancelLocalSchedules(): void {
  void (async () => {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const pending = await LocalNotifications.getPending().catch(() => null);
      const list = (pending as { notifications?: { id: number }[] } | null)?.notifications ?? [];
      if (list.length > 0) {
        await LocalNotifications.cancel({
          notifications: list.map((n) => ({ id: n.id })),
        }).catch(() => {});
      }
    } catch { /* ignore — تكميلي ولا يمنع الخروج */ }
  })();
}

export type DeletedAction = {
  doLocalLogout: () => void;
  notifyUser: (title: string, message: string) => void;
};

/** حدث يُبث عند ثبوت الحذف — تلتقطه App لتحديث الواجهة فوراً (setUser(null)). */
export const ACCOUNT_DELETED_EVENT = 'mohanndes-account-deleted';

function broadcastAccountDeleted(): void {
  try {
    window.dispatchEvent(new CustomEvent(ACCOUNT_DELETED_EVENT));
  } catch { /* ignore */ }
}

/** تصفير ذاكرة الفحص (يُستدعى عند تسجيل الدخول/الخروج اليدوي). */
export function resetDeletedGuard(): void {
  lastCheckAt = 0;
  lastCheckOutcome = null;
}

/** الفحص المركزي: عند الثبوت القطعي للحذف فقط يبطل الارتباطات ويسجل الخروج. */
export async function guardDeletedUser(action: DeletedAction): Promise<boolean> {
  const session = readStoredSession();
  if (!session) return false;
  const now = Date.now();
  if (lastCheckOutcome === 'valid' && now - lastCheckAt < CHECK_THROTTLE_MS) return false;
  const result = await checkAccountExists(session.phone);
  if (result === UNKNOWN) return false; // غير مؤكد → لا نفعل شيئاً إطلاقاً
  lastCheckAt = now;
  if (result !== null) {
    lastCheckOutcome = 'valid';
    return false; // الحساب موجود → إبقاء كل شيء
  }
  lastCheckOutcome = 'deleted';
  try { invalidateDeviceLinks(); } catch { /* ignore */ }
  try { cancelLocalSchedules(); } catch { /* ignore */ }
  try { localStorage.removeItem('univ_user'); } catch { /* ignore */ }
  try { action.doLocalLogout(); } catch { /* ignore */ }
  broadcastAccountDeleted(); // App تلتقطه → setUser(null) + setDeveloperSession(false)
  try {
    action.notifyUser('تم حذف حسابك', 'قام المشرف بحذف حسابك. تم تسجيل خروجك وإيقاف الإشعارات.');
  } catch { /* ignore */ }
  return true;
}
