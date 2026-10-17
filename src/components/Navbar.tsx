import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, BookOpen, ClipboardList, Bell, Users, GraduationCap, Menu, X, LogOut, User as UserIcon, FileText, Shield, Settings, BookMarked, MessageSquare, Sun, Moon, UserCog, Sparkles } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';

export type TabId = 'schedule' | 'assignments' | 'study' | 'exams' | 'notifications' | 'references' | 'feedback' | 'registrations' | 'settings' | 'userSettings' | 'about';

const APP_NAME = 'المهندس';

type NavItem = {
  id: TabId;
  label: string;
  icon: typeof CalendarDays;
  devOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { id: 'schedule', label: 'الجدول', icon: CalendarDays },
  { id: 'assignments', label: 'التكاليف', icon: ClipboardList },
  { id: 'study', label: 'المذاكرة', icon: BookOpen },
  { id: 'exams', label: 'الاختبارات', icon: FileText },
  { id: 'notifications', label: 'الإشعارات', icon: Bell },
  { id: 'references', label: 'المراجع', icon: BookMarked },
  { id: 'feedback', label: 'تواصل', icon: MessageSquare },
  { id: 'userSettings', label: 'إعداداتي', icon: UserCog },
  { id: 'about', label: 'عن المطور', icon: Sparkles },
  { id: 'registrations', label: 'المسجلون', icon: Users, devOnly: true },
  { id: 'settings', label: 'الإعدادات', icon: Settings, devOnly: true },
];

type Props = {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  notificationCount: number;
  registrationsCount: number;
  /** Per-tab unseen counts (schedule/assignments/exams/references/...). */
  sectionBadges: Record<string, number>;
  userName: string;
  userDepartment: string | null;
  isDeveloper: boolean;
  onLogout: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
};

export default function Navbar({ activeTab, onTabChange, notificationCount, registrationsCount, sectionBadges, userName, userDepartment, isDeveloper, onLogout, theme, onToggleTheme }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);

  const requestLogout = () => {
    setMobileOpen(false);
    setConfirmLogout(true);
  };

  const confirmAndLogout = () => {
    setConfirmLogout(false);
    onLogout();
  };

  // Android hardware back button: first press asks "هل تريد الخروج؟",
  // second press (while the dialog is open) exits the app.
  useEffect(() => {
    let listener: { remove: () => void } | null = null;
    try {
      if (Capacitor.isNativePlatform()) {
        CapacitorApp.addListener('backButton', ({ canGoBack }) => {
          if (!canGoBack) {
            setConfirmExit((prev) => {
              if (prev) {
                try { CapacitorApp.exitApp(); } catch { /* ignore */ }
              }
              return true;
            });
          }
        }).then((h) => { listener = h; }).catch(() => {});
      }
    } catch { /* ignore */ }
    return () => { try { listener?.remove(); } catch { /* ignore */ } };
  }, []);

  const handleTabClick = (tab: TabId) => {
    onTabChange(tab);
    setMobileOpen(false);
  };

  // Badge count for a given tab: max of the legacy sources (notifications
  // list + registrations live tracker) and the per-section counter, so a
  // boot-time seed and a live markUnseen never disagree.
  const badgeFor = (id: TabId): number => {
    const legacy =
      id === 'notifications'
        ? notificationCount
        : id === 'registrations'
          ? registrationsCount
          : 0;
    return Math.max(legacy, sectionBadges[id] ?? 0);
  };

  const visibleItems = NAV_ITEMS.filter((item) => !item.devOnly || isDeveloper);
  const deptLabel = userDepartment === 'ميكاترونكس' ? 'هندسة الميكاترونكس' : userDepartment === 'كهربائية' ? 'هندسة كهرباء' : null;

  return (
    <header className="sticky top-0 z-50 pt-[calc(env(safe-area-inset-top,0px))] px-[calc(1rem+env(safe-area-inset-left,0px))] sm:px-[calc(1.5rem+env(safe-area-inset-left,0px))] bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-sm transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-md">
              <GraduationCap className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">{APP_NAME}</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">{isDeveloper ? 'لوحة المطور' : 'نظّم وقتك واجتهد'}</p>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleTabClick(item.id)}
                  className={`relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? item.devOnly ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400' : 'bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-400'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                  {badgeFor(item.id) > 0 && (
                    <span
                      className={`absolute -top-1 -left-1 text-white text-[10px] font-bold min-w-5 h-5 px-1 rounded-full flex items-center justify-center animate-scale-in bg-red-500`}
                    >
                      {badgeFor(item.id) > 99 ? '99+' : badgeFor(item.id)}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <button
              onClick={onToggleTheme}
              className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
              title={theme === 'light' ? 'الوضع الداكن' : 'الوضع الفاتح'}
            >
              {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </button>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
              isDeveloper ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800' : 'bg-teal-50 dark:bg-teal-950/50 border-teal-100 dark:border-teal-900'
            }`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                isDeveloper ? 'bg-gradient-to-br from-amber-400 to-orange-500' : 'bg-gradient-to-br from-teal-400 to-cyan-500'
              }`}>
                {userName.charAt(0)}
              </div>
              <div className="flex flex-col">
                <span className={`text-sm font-medium ${isDeveloper ? 'text-amber-700 dark:text-amber-400' : 'text-teal-700 dark:text-teal-400'}`}>
                  {userName.split(/\s+/)[0]}
                </span>
                {isDeveloper ? (
                  <span className="text-[10px] text-amber-500 dark:text-amber-500 font-medium flex items-center gap-0.5">
                    <Shield className="w-2.5 h-2.5" /> مطور
                  </span>
                ) : deptLabel ? (
                  <span className="text-[10px] text-teal-500 dark:text-teal-500 font-medium">{deptLabel}</span>
                ) : null}
              </div>
            </div>
            <button
              onClick={requestLogout}
              className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/50 transition-all"
              title="تسجيل خروج"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <button
              onClick={onToggleTheme}
              className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
            >
              {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </button>
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {mobileOpen && (
        <nav className="md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-fade-in transition-colors duration-300">
          <div className="px-4 py-3 space-y-1">
            <div className={`flex items-center gap-3 px-4 py-3 mb-2 rounded-lg border ${
              isDeveloper ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800' : 'bg-teal-50 dark:bg-teal-950/50 border-teal-100 dark:border-teal-900'
            }`}>
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold ${
                isDeveloper ? 'bg-gradient-to-br from-amber-400 to-orange-500' : 'bg-gradient-to-br from-teal-400 to-cyan-500'
              }`}>
                {userName.charAt(0)}
              </div>
              <div className="flex-1">
                <p className="text-xs text-slate-500 dark:text-slate-400">المستخدم</p>
                <div>
                  <p className={`font-semibold flex items-center gap-1 ${isDeveloper ? 'text-amber-700 dark:text-amber-400' : 'text-teal-700 dark:text-teal-400'}`}>
                    <UserIcon className="w-3.5 h-3.5" />
                    {userName.split(/\s+/)[0]}
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">{userName}</p>
                  {isDeveloper ? (
                    <p className="text-[10px] text-amber-500 dark:text-amber-500 font-medium flex items-center gap-0.5 mt-0.5">
                      <Shield className="w-2.5 h-2.5" /> مطور
                    </p>
                  ) : deptLabel ? (
                    <p className="text-[10px] text-teal-500 dark:text-teal-500 font-medium mt-0.5">{deptLabel}</p>
                  ) : null}
                </div>
              </div>
              <button
                onClick={requestLogout}
                className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/50 transition-all"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleTabClick(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? item.devOnly ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400' : 'bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-400'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {item.label}
                  {badgeFor(item.id) > 0 && (
                    <span
                      className={`mr-auto text-white text-[10px] font-bold min-w-5 h-5 px-1 rounded-full flex items-center justify-center bg-red-500`}
                    >
                      {badgeFor(item.id) > 99 ? '99+' : badgeFor(item.id)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      )}
      {confirmLogout && createPortal(
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center px-4 bg-black/50 backdrop-blur-sm animate-fade-in"
          onClick={() => setConfirmLogout(false)}
        >
          <div
            className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-6 text-center animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 mx-auto rounded-2xl bg-red-50 dark:bg-red-950/50 flex items-center justify-center mb-4">
              <LogOut className="w-7 h-7 text-red-500" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-1">تسجيل الخروج؟</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">هل أنت متأكد من الخروج من التطبيق؟</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmLogout(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
              >
                إلغاء
              </button>
              <button
                onClick={confirmAndLogout}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold shadow-md transition-all"
              >
                خروج
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {confirmExit && createPortal(
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center px-4 bg-black/50 backdrop-blur-sm animate-fade-in"
          onClick={() => setConfirmExit(false)}
        >
          <div
            className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-6 text-center animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center mb-4">
              <LogOut className="w-7 h-7 text-amber-500" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-1">الخروج من التطبيق؟</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">هل أنت متأكد من الخروج من التطبيق؟</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmExit(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
              >
                البقاء
              </button>
              <button
                onClick={() => { try { CapacitorApp.exitApp(); } catch { setConfirmExit(false); } }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold shadow-md transition-all"
              >
                خروج
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </header>
  );
}
