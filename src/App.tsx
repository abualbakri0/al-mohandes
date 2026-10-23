import { useState, useEffect, useCallback, useRef } from 'react';
import Navbar, { type TabId } from '@/components/Navbar';
import ScheduleView from '@/components/ScheduleView';
import DailyProgramView from '@/components/DailyProgramView';
import AssignmentsView from '@/components/AssignmentsView';
import StudyView from '@/components/StudyView';
import ExamsView from '@/components/ExamsView';
import NotificationsView from '@/components/NotificationsView';
import RegistrationsView from '@/components/RegistrationsView';
import SettingsView from '@/components/SettingsView';
import ReferencesView from '@/components/ReferencesView';
import FeedbackView from '@/components/FeedbackView';
import RegistrationGate from '@/components/RegistrationGate';
import UserSettingsView from '@/components/UserSettingsView';
import AboutDeveloperView from '@/components/AboutDeveloperView';
import NightAlertBanner from '@/components/NightAlertBanner';
import NotificationPermissionPrompt from '@/components/NotificationPermissionPrompt';
import OfflineBanner from '@/components/OfflineBanner';
import InstallPrompt from '@/components/InstallPrompt';
import PullToRefresh from '@/components/PullToRefresh';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useToast } from '@/components/ToastProvider';
import { fetchSettings, checkRegistration, useSectionBadges, clearSection, seedSectionBadges, isDeveloperSession, setDeveloperSession, validateDeveloperGrant, clearProgressKey, hasProgressKey, isProgressIsolationDeployed } from '@/lib/api';
import { flushQueue } from '@/lib/offlineSync';
import { pendingCount } from '@/lib/offlineStore';
import { useNightAlerts } from '@/hooks/useNightAlerts';
import { useBrowserNotifications, requestNotificationPermission } from '@/hooks/useBrowserNotifications';
import { useRealtimeNotifications, useRealtimeRegistrations } from '@/hooks/useRealtimeNotifications';
import { useOfficialRealtime } from '@/hooks/useOfficialRealtime';
import { useLectureReminders } from '@/hooks/useLectureReminders';
import { requestNativePermission, onNativeNotificationTap } from '@/lib/nativeNotifications';
import { bindPushDisplay, initPush, setPushDepartment, flushPushRegistration, unregisterPushToken } from '@/lib/push';
import { guardDeletedUser, resetDeletedGuard, ACCOUNT_DELETED_EVENT } from '@/lib/deletedGuard';
import { initWebPush, setWebPushDepartment, flushWebPushRegistration } from '@/lib/webPush';
import { setAppBadge, clearAppBadge } from '@/lib/appBadge';
import { useTheme } from '@/hooks/useTheme';
import { useToday } from '@/hooks/useToday';
import type { Registration, Department, AppSettings, Notification as AppNotification } from '@/lib/supabase';
import { CalendarDays as CalendarWeekIcon, Clock as ClockIcon, Calendar as CalendarIcon } from 'lucide-react';

const APP_NAME = 'المهندس';
const DEV_NAME = 'أبوبكر الحيدري';
const DEV_PHONE = '779809243';

/** شاشة الترحيب المخصصة: اللوجو + الشعار + عبارة الشغف الهندسي */
// زمن أدنى للعرض: 3000ms (3 ثوانٍ) حتى يراها المستخدم كاملة بوضوح بغض النظر عن سرعة الجهاز.
const INTRO_MIN_MS = 3000;

function IntroScreen({ onFinish }: { onFinish: () => void }) {
  const [animate, setAnimate] = useState(false);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    // بدء الحركة بعد لحظة قصيرة
    const t1 = setTimeout(() => setAnimate(true), 80);
    // زمن أدنى للعرض 2000ms حتى يرى المستخدم الشاشة كاملة بوضوح
    const t2 = setTimeout(() => {
      // انتقال ناعم (Fade) قبل الانتقال للشاشة الرئيسية
      setFading(true);
      setTimeout(onFinish, 450);
    }, INTRO_MIN_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onFinish]);

  return (
    <div className={`min-h-screen bg-gradient-to-br from-teal-900 via-indigo-900 to-slate-950 flex flex-col items-center justify-center text-white transition-opacity duration-500 ${fading ? 'opacity-0' : 'opacity-100'}`}>
      {/* أيقونة التطبيق الحقيقية داخل مربع احترافي مبروم الأطراف */}
      <div
        className={`w-32 h-32 rounded-[28px] overflow-hidden bg-white/5 ring-1 ring-white/20 shadow-2xl shadow-teal-500/30 backdrop-blur-sm transition-all duration-1000 ease-out ${
          animate ? 'scale-100 rotate-0 opacity-100' : 'scale-50 rotate-6 opacity-0'
        }`}
      >
        <img src="./icons/icon-512.png" alt="أيقونة تطبيق المهندس" className="w-full h-full object-cover" draggable={false} />
      </div>

      {/* اسم التطبيق */}
      <h1
        className={`mt-10 text-4xl font-black tracking-tight text-white drop-shadow-lg transition-all duration-1000 ${
          animate ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
        }`}
      >
        المهندس
      </h1>

      <p className="mt-3 text-slate-300 text-sm transition-all duration-1000 animate-pulse">
        صُنِعَ بشغف هندسي
      </p>
    </div>
  );
}

function App() {
  const { showToast } = useToast();
  const [user, setUser] = useState<Registration | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [introDone, setIntroDone] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('schedule');
  // Server-validated developer grant — never a raw localStorage flag.
  const [devGrant, setDevGrant] = useState(false);
  const refreshDevGrant = useCallback(() => {
    // Immediate signal from the signed token (if any), then the authoritative
    // server-side check (verify_dev_token). A forged `is_dev` grants nothing.
    setDevGrant(isDeveloperSession());
    void validateDeveloperGrant()
      .then((ok) => setDevGrant(ok))
      .catch(() => {
        /* keep the last known value */
      });
  }, []);

  // جلب بيانات التهيئة من Supabase بالتوازي مع عرض الشاشة —
  // لا ننتقل للرئيسية إلا بعد اكتمال الجلب AND انقضاء المدة الدنيا.
  useEffect(() => {
    const started = Date.now();
    let cancelled = false;
    // جلب بيانات التهيئة (fetchSettings) يعمل بالتوازي مع عرض الشاشة.
    fetchSettings()
      .then((s) => { if (!cancelled && s) setSettings(s); })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        const elapsed = Date.now() - started;
        const wait = Math.max(0, INTRO_MIN_MS - elapsed);
        setTimeout(() => { if (!cancelled) setIntroDone(true); }, wait);
      });
    // حد أمان: لا تبقى الشاشة أكثر من 6 ثوانٍ مهما حدث.
    const guard = setTimeout(() => { if (!cancelled) setIntroDone(true); }, 6000);
    return () => {
      cancelled = true;
      clearTimeout(guard);
    };
  }, []);
  const [allNotifications, setAllNotifications] = useState<AppNotification[]>([]);
  const [seenNotifIds, setSeenNotifIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('univ_seen_notifs');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  // Unseen new registrations (developer only): badge on "المسجلون" tab.
  // Persisted per account so the badge survives restarts; cleared when
  // the developer opens the registrations tab.
  const [unseenRegIds, setUnseenRegIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('univ_unseen_regs');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  const unseenRegCount = unseenRegIds.length;
  // Badge shows only genuinely unread notifications; it clears once the user
  // opens the notifications tab (see handleTabChange below).
  const unreadNotificationCount = allNotifications.filter((n) => !seenNotifIds.includes(n.id)).length;

  // Reactive per-section unseen counters (schedule/assignments/exams/references/…).
  // Populated by officialEmit.markUnseen() on every realtime/FCM alert.
  const sectionBadges = useSectionBadges();

  // Mirror the unread count onto the launcher icon badge
  // (and document.title on web) so it stays correct from outside the app.
  useEffect(() => {
    // Developer sees registrations badge too — combine both.
    void setAppBadge(unreadNotificationCount + unseenRegCount);
  }, [unreadNotificationCount, unseenRegCount]);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const { theme, toggleTheme } = useTheme();
  const handleTabChangeRef = useRef<(tab: TabId) => void>(() => {});
  const today = useToday();
  const isOnline = useOnlineStatus();
  // Bumped every time we need every visible view to reload its data
  // (manual pull-to-refresh, or automatic refresh when back online).
  // It is passed as `key` to each view so React remounts it and re-runs its load().
  const [refreshKey, setRefreshKey] = useState(0);
  const wasOfflineRef = useRef(false);

  const refreshAll = useCallback(async () => {
    setRefreshKey((k) => k + 1);
    // Give remounted views a tick to start their own loads.
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      const s = await fetchSettings();
      setSettings(s);
    } catch {
      // ignore — individual views handle their own errors
    }
  }, []);

  // Auto-refresh stale data the moment connectivity returns — and first
  // publish anything the developer queued while offline.
  useEffect(() => {
    if (!isOnline) {
      wasOfflineRef.current = true;
      return;
    }
    if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      (async () => {
        if (pendingCount() > 0) {
          const { done, failed, failures, dropped = 0 } = await flushQueue();
          if (done > 0) {
            showToast(
              'عاد الاتصال — تم النشر',
              `تم نشر ${done} عملية محفوظة أثناء عدم الاتصال${failed > 0 ? ` (${failed} عملية ستُعاد محاولتها لاحقًا)` : ''}`,
              'success'
            );
          }
          if (failed > 0) {
            const firstFailure = failures[0];
            const details = firstFailure
              ? `فشلت «${firstFailure.label}»: ${firstFailure.reason}`
              : `${failed} عملية ما زالت في قائمة الانتظار`;
            showToast('تعذر نشر بعض العمليات', details, 'warning', undefined, undefined, undefined, 10000);
          }
          if (dropped > 0) {
            showToast(
              'تم تجاهل عمليات عالقة',
              `${dropped} عملية لم تعد قابلة للتنفيذ وحُذفت من قائمة الانتظار`,
              'info'
            );
          }
        }
        refreshAll();
      })();
    }
  }, [isOnline, refreshAll, showToast]);

  // On startup: publish any leftover queued operations from a previous session.
  useEffect(() => {
    if (!isOnline || !user) return;
    if (pendingCount() === 0) return;
    let cancelled = false;
    flushQueue().then(({ done, failed, failures, dropped = 0 }) => {
      if (cancelled) return;
      if (done > 0) {
        showToast('تم النشر', `تم نشر ${done} عملية محفوظة من قبل`, 'success');
        refreshAll();
      }
      if (failed > 0) {
        const firstFailure = failures[0];
        showToast(
          'تعذر نشر بعض العمليات',
          firstFailure ? `فشلت «${firstFailure.label}»: ${firstFailure.reason}` : `${failed} عملية ما زالت في قائمة الانتظار`,
          'warning',
          undefined,
          undefined,
          undefined,
          10000
        );
      }
      if (dropped > 0) {
        showToast(
          'تم تجاهل عمليات عالقة',
          `${dropped} عملية لم تعد قابلة للتنفيذ وحُذفت من قائمة الانتظار`,
          'info'
        );
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, user]);

  const isDeveloper =
    (user?.name === DEV_NAME && user?.phone === DEV_PHONE) ||
    devGrant;

  const userDepartment: Department | null = isDeveloper ? null : user?.department ?? null;

  // Reconcile badges with content that arrived while the app was CLOSED
  // (markUnseen only runs while alive). First run baselines per section to
  // "now", so this never floods badges with historical rows.
  useEffect(() => {
    if (!user) return;
    seedSectionBadges(userDepartment, isDeveloper);
    // Also re-reconcile when the app returns to the foreground after a pause.
    const onFocus = () => seedSectionBadges(userDepartment, isDeveloper);
    window.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [user, userDepartment, isDeveloper]);

  const nightAlert = useNightAlerts(userDepartment ?? undefined);

  // Request OFFICIAL notification permission on login (system bar, WhatsApp-style)
  useEffect(() => {
    if (user) {
      try { resetDeletedGuard(); } catch { /* ignore */ } // جلسة جديدة → فحص جديد
      requestNativePermission().catch(() => {});
      requestNotificationPermission().catch(() => {});
    }
  }, [user]);

  // Tapping a system notification deep-links to the right tab
  useEffect(() => {
    const off = onNativeNotificationTap((data) => {
      const tab = data?.tab as TabId | undefined;
      if (tab) handleTabChangeRef.current(tab);
    });
    return off;
  }, []);

  // Tapping a Web Push notification (PWA install) — the Service Worker posts
  // this message when the user clicks the tray notification.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMsg = (event: MessageEvent) => {
      const data = event.data as { type?: string; tab?: string } | undefined;
      if (data?.type === 'mohanndes-notif-click' && data.tab) {
        handleTabChangeRef.current(data.tab as TabId);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    refreshDevGrant();
    const stored = localStorage.getItem('univ_user');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Registration;
        // Auth Guard: reject forged/malformed stored sessions (direct-URL
        // or hand-crafted localStorage must never unlock inner pages).
        const phoneOk = typeof parsed?.phone === 'string' && /^7\d{8}$/.test(parsed.phone.replace(/\D/g, ''));
        const idOk = typeof parsed?.id === 'string' && parsed.id.length >= 8;
        const nameOk = typeof parsed?.name === 'string' && parsed.name.trim().length > 0;
        if (!phoneOk || !idOk || !nameOk) {
          localStorage.removeItem('univ_user');
          setDeveloperSession(false);
          setUser(null);
          setCheckingAuth(false);
          fetchSettings().then(setSettings).catch(() => {});
          return;
        }
        // Restore this stored session (shared by the dev shortcut below and
        // the normal restore path).
        const restoreSession = () => {
          // Developer shortcut only for the real developer identity; the
          // localStorage flag no longer grants (validated via refreshDevGrant).
          const isDev = parsed.name === DEV_NAME && parsed.phone === DEV_PHONE;
          if (isDev) {
            setUser(parsed);
            setCheckingAuth(false);
            fetchSettings().then(setSettings).catch(() => {});
            return;
          }
          // Restore the stored session immediately. Network validation must not
          // hide the app or discard a valid local session while offline.
          setUser(parsed);
          setCheckingAuth(false);
          void (async () => {
            // ── فحص المستخدم المحذوف عند الإقلاع (خلفية فقط) ──
            // عبر وحدة الحارس المشتركة (deletedGuard): الجلسة تُستعاد فوراً
            // أعلاه ولا تُمس. الخروج الإجباري + إبطال الارتباطات يتم فقط
            // عند الثبوت القطعي للحذف (null مؤكد شبكياً — ليس timeout/خطأ).
            const wasDeleted = await guardDeletedUser({
              doLocalLogout: () => {
                setDeveloperSession(false);
                setUser(null);
              },
              notifyUser: (t, m) => showToast(t, m, 'error'),
            }).catch(() => false);
            if (wasDeleted) return; // تم التعامل (خروج + إبطال ارتباطات + رسالة)
            // الحساب موجود ومقبول → حدّث النسخة المحلية كالسابق.
            const UNKNOWN = Symbol('unknown');
            let fresh: Registration | null | typeof UNKNOWN = UNKNOWN;
            try {
              fresh = await Promise.race([
                checkRegistration(parsed.phone),
                new Promise<typeof UNKNOWN>((resolve) => setTimeout(() => resolve(UNKNOWN), 8000)),
              ]);
            } catch {
              fresh = UNKNOWN; // خطأ شبكي → ليس حذفاً → إبقاء الجلسة
            }
            if (fresh === UNKNOWN) return; // timeout/خطأ → إبقاء الجلسة بصمت تام
            if (fresh && fresh.is_approved) {
              localStorage.setItem('univ_user', JSON.stringify(fresh));
              setUser(fresh);
            } else if (fresh && !fresh.is_approved) {
              localStorage.removeItem('univ_user');
              setDeveloperSession(false);
              setUser(null);
            }
            // ملاحظة: حالة fresh === null (محذوف) عُولجت أعلاه عبر الحارس
            // (خروج + إبطال ارتباطات + إلغاء مجدولات + رسالة) — لا تكرار هنا.
          })();
        };

        // Server-side progress isolation (Section 11): a session predating its
        // progress key cannot read/write checkmarks once direct table access
        // is revoked. Ask for the password ONCE (back to the gate) to mint the
        // key — but never over a flaky network or before the RPCs exist
        // (either case simply keeps the old behaviour).
        if (!hasProgressKey(parsed.id)) {
          void (async () => {
            const deployed = await Promise.race([
              isProgressIsolationDeployed(),
              new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000)),
            ]).catch(() => false);
            if (deployed) {
              localStorage.removeItem('univ_user');
              setDeveloperSession(false);
              setUser(null);
              setCheckingAuth(false);
              fetchSettings().then(setSettings).catch(() => {});
            } else {
              restoreSession();
            }
          })();
          return;
        }
        restoreSession();
        return;
      } catch {
        // Preserve malformed/unreadable stored data for diagnosis/recovery;
        // never turn a transient startup/storage error into an implicit logout.
      }
    }
    setCheckingAuth(false);
    fetchSettings().then(setSettings).catch(() => {});
  }, [refreshDevGrant]);

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
    // When the user opens the notifications tab, mark every currently loaded
    // notification as seen so the red badge disappears.
    if (tab === 'notifications') {
      void clearAppBadge();
      setAllNotifications((prev) => {
        const ids = prev.map((n) => n.id);
        if (ids.length > 0) {
          setSeenNotifIds((seen) => {
            const merged = Array.from(new Set([...seen, ...ids]));
            try { localStorage.setItem('univ_seen_notifs', JSON.stringify(merged)); } catch { /* ignore */ }
            return merged;
          });
        }
        return prev;
      });
    }
    // When the developer opens the registrations tab, clear the "new" badge.
    if (tab === 'registrations') {
      setUnseenRegIds([]);
      try { localStorage.setItem('univ_unseen_regs', '[]'); } catch { /* ignore */ }
    }
    // Clear the reactive per-section badge for whichever tab was opened, so the
    // nav dot disappears once the user actually sees the new content.
    clearSection(tab);
  }, []);

  useEffect(() => {
    handleTabChangeRef.current = handleTabChange;
  }, [handleTabChange]);

  const handleNewNotification = useCallback((n: AppNotification) => {
    setAllNotifications((prev) => [n, ...prev]);
    // Toast + system notification are handled by useOfficialRealtime (no double alert here).
  }, []);

  const handleInitialNotifications = useCallback((notifications: AppNotification[]) => {
    setAllNotifications(notifications);
  }, []);

  useRealtimeNotifications({
    department: userDepartment,
    enabled: !!user,
    onNewNotification: handleNewNotification,
    onInitialNotifications: handleInitialNotifications,
  });

  const handleNewRegistration = useCallback((r: Registration) => {
    // Toast + system notification are handled by useOfficialRealtime (no double alert here).
    // Track it as "unseen" so the المسجلون tab shows a badge until opened.
    setUnseenRegIds((prev) => {
      if (prev.includes(r.id)) return prev;
      const next = [...prev, r.id];
      try { localStorage.setItem('univ_unseen_regs', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const handleInitialRegistrations = useCallback(() => {
    // No-op — RegistrationsView loads its own data.
    // NOTE: we intentionally do NOT mark initial rows as unseen — the badge
    // is only for registrations that arrive while the app is running.
  }, []);

  useRealtimeRegistrations({
    enabled: !!user && isDeveloper,
    onNewRegistration: handleNewRegistration,
    onInitialRegistrations: handleInitialRegistrations,
  });

  // Browser notifications (night alerts)
  useBrowserNotifications(
    allNotifications,
    nightAlert?.lectures ?? null,
    nightAlert?.dayName ?? null,
    nightAlert?.type === 'holiday',
    !!user,
    nightAlert?.assignments ?? [],
    nightAlert?.exams ?? [],
  );

  // OFFICIAL realtime system notifications (WhatsApp-style in the status bar):
  // student content + developer (new registration / feedback with first+last name)
  useOfficialRealtime({
    department: userDepartment,
    isDeveloper,
    showToast,
    goToTab: (tab: TabId) => handleTabChangeRef.current(tab),
  });

  // FCM background push (the ONLY channel that works with the app fully
  // closed/killed). Realtime covers the foreground instantly; FCM display
  // messages are rendered by Android itself. The display bridge is rebound
  // every render so foreground FCM toasts use fresh callbacks.
  useEffect(() => {
    bindPushDisplay({ showToast, goToTab: (tab: TabId) => handleTabChangeRef.current(tab) });
  });
  useEffect(() => {
    void initPush();
    // PWA/website installs use Web Push instead of FCM (no-op on native).
    void initWebPush();
    // إعادة محاولة التسجيل في الحالات التي يفشل فيها أول تسجيل:
    // عودة الشبكة، أو عودة التطبيق للمقدمة (شائع على أندرويد بعد إغلاق
    // النظام للشبكة أثناء الإقلاع). كلها fire-and-forget ولا ترمي أبداً.
    const retry = () => {
      try {
        flushPushRegistration();
      } catch { /* ignore */ }
      try {
        flushWebPushRegistration();
      } catch { /* ignore */ }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') retry();
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  useEffect(() => {
    setPushDepartment(userDepartment, isDeveloper);
    setWebPushDepartment(userDepartment, isDeveloper);
  }, [userDepartment, isDeveloper]);

  // Scheduled native reminders: 60min + 15min before lectures, evening summary 19:00
  useLectureReminders(userDepartment, user?.name);

  // ── فحص دوري للمستخدم المحذوف (جلسة نشطة) ──
  // يعمل فقط أثناء وجود جلسة محلية، كل 15 دقيقة + عند عودة التطبيق للمقدمة.
  // عبر وحدة الحارس المشتركة: لا إجراء إطلاقاً إلا عند الثبوت القطعي للحذف
  // (null مؤكد شبكياً). timeout/خطأ/أوفلاين = إبقاء الجلسة بصمت تام.
  // لا يمس نظام الإشعارات — فقط يبطل الارتباطات عند ثبوت الحذف.
  // + مستمع حدث الحذف: إذا ثبت الحذف من أي مسار آخر (بوابة الإشعار)،
  // تُحدَّث الواجهة فوراً (خروج لشاشة الدخول) دون انتظار الفحص التالي.
  useEffect(() => {
    const onDeleted = () => {
      try { resetDeletedGuard(); } catch { /* ignore */ }
      setDeveloperSession(false);
      setUser(null);
    };
    window.addEventListener(ACCOUNT_DELETED_EVENT, onDeleted);
    return () => window.removeEventListener(ACCOUNT_DELETED_EVENT, onDeleted);
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const runCheck = () => {
      if (cancelled) return;
      void guardDeletedUser({
        doLocalLogout: () => {
          setDeveloperSession(false);
          setUser(null);
        },
        notifyUser: (t, m) => showToast(t, m, 'error'),
      }).catch(() => {});
    };
    const interval = setInterval(runCheck, 15 * 60_000);
    const onForeground = () => runCheck();
    window.addEventListener('focus', onForeground);
    document.addEventListener('visibilitychange', onForeground);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onForeground);
      document.removeEventListener('visibilitychange', onForeground);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleLogout = () => {
    // ── الحالة الثانية (الخروج اليدوي فقط): تنظيف FCM Token من السيرفر ──
    // قبل مسح الجلسة المحلية: حذف/تصفير توكن هذا الجهاز من جدول push_tokens
    // ليتوقف عن استقبال الإشعارات. fire-and-forget — لا يمنع الخروج أبداً.
    // (لا يمس أي جزء آخر من نظام الإشعارات.)
    try { unregisterPushToken(); } catch { /* ignore */ }
    try { resetDeletedGuard(); } catch { /* ignore */ }
    localStorage.removeItem('univ_user');
    if (user) clearProgressKey(user.id);
    setDeveloperSession(false);
    setDevGrant(false);
    setUser(null);
  };

  const currentWeek = settings?.semester_start_date
    ? Math.floor((Date.now() - new Date(settings.semester_start_date).getTime()) / (1000 * 60 * 60 * 24 * 7)) + 1
    : null;

  // الشاشة الافتتاحية التفاعلية تظهر أول شيء عند فتح التطبيق.
  if (!introDone) {
    return <IntroScreen onFinish={() => setIntroDone(true)} />;
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center transition-colors duration-300">
        <div className="w-8 h-8 border-3 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <RegistrationGate onRegistered={(r) => { setUser(r); refreshDevGrant(); }} />;
  }

  const showBanner = nightAlert && !bannerDismissed;
  const nameParts = user.name.split(/\s+/);
  const firstName = nameParts[0] ?? '';
  const lastName = nameParts[nameParts.length - 1] ?? '';
  const displayName = [...nameParts.slice(0, 2), ...(nameParts.length > 2 ? [lastName] : [])].join(' ');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col transition-colors duration-300">
      <Navbar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        notificationCount={unreadNotificationCount}
        registrationsCount={unseenRegCount}
        sectionBadges={sectionBadges}
        userName={user.name}
        userDepartment={user.department}
        isDeveloper={isDeveloper}
        onLogout={handleLogout}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <OfflineBanner isOnline={isOnline} />
      <NotificationPermissionPrompt />
      <InstallPrompt />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Welcome banner */}
        <div className="mb-6 bg-gradient-to-br from-teal-600 to-cyan-700 dark:from-teal-800 dark:to-cyan-900 rounded-2xl p-5 sm:p-6 shadow-lg animate-fade-in-up transition-colors duration-300">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                {firstName.charAt(0)}
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">
                  أهلاً بك، {displayName}
                </h2>
                <p className="text-teal-100 text-sm">
                  {isDeveloper
                    ? 'أنت في وضع المطور — تحكم كامل في البرنامج'
                    : user.department === 'ميكاترونكس'
                    ? 'هندسة الميكاترونكس'
                    : user.department === 'كهربائية'
                    ? 'هندسة كهرباء'
                    : user.department === 'مشترك'
                    ? 'ميكاترونكس + كهرباء'
                    : ''}
                </p>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  <span className="flex items-center gap-1 text-teal-50 text-xs font-medium">
                    <CalendarIcon className="w-3.5 h-3.5" />
                    {today.dayName}
                  </span>
                  <span className="flex items-center gap-1 text-teal-50 text-xs font-medium">
                    <CalendarWeekIcon className="w-3.5 h-3.5" />
                    {today.dateLabel}
                  </span>
                  <span className="flex items-center gap-1 text-teal-50 text-xs font-medium tabular-nums">
                    <ClockIcon className="w-3.5 h-3.5" />
                    {today.timeLabel}
                  </span>
                </div>
              </div>
            </div>
            {settings && (
              <div className="flex items-center gap-3 bg-white/15 backdrop-blur rounded-xl px-4 py-2">
                <div className="text-center">
                  <p className="text-[10px] text-teal-100">المستوى</p>
                  <p className="text-sm font-bold text-white">{settings.academic_level}</p>
                </div>
                <div className="w-px h-8 bg-white/20" />
                <div className="text-center">
                  <p className="text-[10px] text-teal-100">الترم</p>
                  <p className="text-sm font-bold text-white">{settings.semester}</p>
                </div>
                {currentWeek !== null && currentWeek > 0 && (
                  <>
                    <div className="w-px h-8 bg-white/20" />
                    <div className="text-center">
                      <p className="text-[10px] text-teal-100">الأسبوع</p>
                      <p className="text-sm font-bold text-white flex items-center gap-1">
                        <CalendarWeekIcon className="w-3.5 h-3.5" />
                        {currentWeek}
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <PullToRefresh key={`ptr-${activeTab}`} onRefresh={refreshAll}>
        {activeTab === 'schedule' && <ScheduleView key={refreshKey} isDeveloper={isDeveloper} department={userDepartment ?? undefined} />}
        {activeTab === 'daily' && <DailyProgramView key={refreshKey} userId={user?.id} department={userDepartment ?? undefined} />}
        {activeTab === 'assignments' && <AssignmentsView key={refreshKey} isDeveloper={isDeveloper} userId={user?.id} department={userDepartment ?? undefined} />}
        {activeTab === 'study' && <StudyView key={refreshKey} isDeveloper={isDeveloper} userId={user?.id} department={userDepartment ?? undefined} />}
        {activeTab === 'exams' && <ExamsView key={refreshKey} isDeveloper={isDeveloper} department={userDepartment ?? undefined} />}
        {activeTab === 'notifications' && <NotificationsView key={refreshKey} isDeveloper={isDeveloper} department={userDepartment ?? undefined} />}
        {activeTab === 'references' && <ReferencesView key={refreshKey} isDeveloper={isDeveloper} department={userDepartment ?? undefined} />}
        {activeTab === 'feedback' && <FeedbackView key={refreshKey} isDeveloper={isDeveloper} userName={user.name} userPhone={user.phone} />}
        {activeTab === 'userSettings' && <UserSettingsView key={refreshKey} user={user} />}
        {activeTab === 'about' && <AboutDeveloperView key={refreshKey} />}
        {activeTab === 'registrations' && isDeveloper && <RegistrationsView key={refreshKey} isDeveloper={isDeveloper} />}
        {activeTab === 'settings' && isDeveloper && <SettingsView key={refreshKey} />}
        </PullToRefresh>
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] mt-auto transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-sm text-slate-400 dark:text-slate-500">{APP_NAME}</p>
          <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
            <span>المطور:</span>
            <span className="font-medium text-slate-500 dark:text-slate-400">{DEV_NAME}</span>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <span dir="ltr" className="text-slate-500 dark:text-slate-400">{DEV_PHONE}</span>
          </div>
        </div>
      </footer>

      {showBanner && nightAlert && (
        <NightAlertBanner
          alert={nightAlert}
          userName={displayName}
          onClose={() => setBannerDismissed(true)}
        />
      )}
    </div>
  );
}

export default App;
