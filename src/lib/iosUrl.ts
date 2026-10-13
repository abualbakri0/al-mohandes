// ============================================================
// رابط نسخة الآيفون (موقع Vercel المستضاف).
// الأولوية: VITE_IOS_URL ← الرابط الثابت الافتراضي ← رابط الموقع الحالي.
// القيمة الثابتة تضمن ظهور الرابط دائماً حتى لو نُسي ضبط متغير البيئة.
// ============================================================

export const DEFAULT_IOS_URL = 'https://al-mohandes-app-2026.vercel.app';

export function getIosAppUrl(): string {
  try {
    const envUrl = (import.meta as unknown as { env?: Record<string, string | undefined> })
      .env?.VITE_IOS_URL?.trim();
    if (envUrl) return envUrl.replace(/\/+$/, '');
  } catch {
    /* ignore */
  }
  if (DEFAULT_IOS_URL) return DEFAULT_IOS_URL;
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
