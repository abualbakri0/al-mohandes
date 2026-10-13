// ============================================================
// رابط نسخة الآيفون (موقع Vercel المستضاف).
// يُقرأ من متغيّر البيئة VITE_IOS_URL، وإن لم يُضبط نستخدم
// رابط الموقع الحالي تلقائياً (يعمل على Vercel بدون أي ضبط).
// لضبط رابط ثابت: أضف في ملف .env الجذري:
//   VITE_IOS_URL=https://your-app.vercel.app
// ============================================================

export function getIosAppUrl(): string {
  try {
    const envUrl = (import.meta as unknown as { env?: Record<string, string | undefined> })
      .env?.VITE_IOS_URL?.trim();
    if (envUrl) return envUrl.replace(/\/+$/, '');
  } catch {
    /* ignore */
  }
  try {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
  } catch {
    /* ignore */
  }
  return '';
}

export function isIOSDevice(): boolean {
  try {
    const ua = navigator.userAgent || '';
    return (
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  } catch {
    return false;
  }
}
