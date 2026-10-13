import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { X, Bell, AlertTriangle, Info, ChevronLeft } from 'lucide-react';
import { playNotificationSound, playRegistrationSound, vibrate } from '@/hooks/useNotificationSound';

type ToastType = 'info' | 'success' | 'warning' | 'error';

type Toast = {
  id: string;
  title: string;
  message: string;
  type: ToastType;
  icon?: typeof Bell;
  actionLabel?: string;
  onAction?: () => void;
  /** Optional override for auto-dismiss; defaults by type (3s normal / 5s important). */
  durationMs?: number;
};

type ToastContextValue = {
  showToast: (title: string, message: string, type?: ToastType, icon?: typeof Bell, actionLabel?: string, onAction?: () => void, durationMs?: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

// Glass ("شفافة ملوّنة") palettes per role. Each function keeps its identity:
// info = teal→cyan (app brand), success = emerald→green, warning = amber→orange
// (reminders), error = rose→red (urgent/errors). Semi-transparent + blur so the
// app content shows through like frosted glass.
const TYPE_STYLES: Record<ToastType, { bg: string; border: string; iconBg: string; iconColor: string; accent: string; progress: string; sound: () => void; vibratePattern: number[] }> = {
  info: { bg: 'bg-gradient-to-br from-teal-500/80 to-cyan-600/80 backdrop-blur-md', border: 'border-teal-200/50 dark:border-teal-300/40', iconBg: 'bg-white/25', iconColor: 'text-white', accent: 'text-white', progress: 'bg-white/60', sound: playNotificationSound, vibratePattern: [200, 100, 200] },
  success: { bg: 'bg-gradient-to-br from-emerald-500/80 to-green-600/80 backdrop-blur-md', border: 'border-emerald-200/50 dark:border-emerald-300/40', iconBg: 'bg-white/25', iconColor: 'text-white', accent: 'text-white', progress: 'bg-white/60', sound: playRegistrationSound, vibratePattern: [150, 80, 150] },
  warning: { bg: 'bg-gradient-to-br from-amber-400/85 to-orange-500/85 backdrop-blur-md', border: 'border-amber-200/50 dark:border-amber-300/40', iconBg: 'bg-white/25', iconColor: 'text-white', accent: 'text-white', progress: 'bg-white/60', sound: playNotificationSound, vibratePattern: [300, 150, 300, 150, 300] },
  error: { bg: 'bg-gradient-to-br from-rose-500/85 to-red-600/85 backdrop-blur-md', border: 'border-rose-200/50 dark:border-rose-300/40', iconBg: 'bg-white/25', iconColor: 'text-white', accent: 'text-white', progress: 'bg-white/60', sound: playNotificationSound, vibratePattern: [400, 200, 400] },
};

// Auto-dismiss duration per importance: normal (info/success) = 3s,
// important (warning/error) = 5s. A toast may override via `durationMs`.
const DURATION_BY_TYPE: Record<ToastType, number> = {
  info: 3000,
  success: 3000,
  warning: 5000,
  error: 5000,
};

function resolveDuration(toast: Toast): number {
  if (toast.durationMs && toast.durationMs > 0) return toast.durationMs;
  return DURATION_BY_TYPE[toast.type];
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const styles = TYPE_STYLES[toast.type];
  const durationMs = resolveDuration(toast);
  const Icon = toast.icon ?? (toast.type === 'warning' ? AlertTriangle : toast.type === 'success' ? Info : toast.type === 'error' ? AlertTriangle : Bell);
  const touchStartX = useRef(0);
  const touchCurrentX = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(100);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimers = useCallback(() => {
    dismissTimer.current = setTimeout(() => onDismiss(toast.id), durationMs);
    const startTime = Date.now();
    progressInterval.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / durationMs) * 100);
      setProgress(remaining);
      if (remaining <= 0 && progressInterval.current) {
        clearInterval(progressInterval.current);
      }
    }, 50);
  }, [toast.id, onDismiss, durationMs]);

  const clearTimers = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    if (progressInterval.current) clearInterval(progressInterval.current);
  }, []);

  useEffect(() => {
    startTimers();
    return clearTimers;
  }, [startTimers, clearTimers]);

  const handleMouseEnter = () => clearTimers();
  const handleMouseLeave = () => {
    setProgress(100);
    startTimers();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    clearTimers();
    touchStartX.current = e.touches[0].clientX;
    touchCurrentX.current = e.touches[0].clientX;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchCurrentX.current = e.touches[0].clientX;
    const offset = touchCurrentX.current - touchStartX.current;
    if (offset < 0) {
      setDragOffset(offset);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    const offset = touchCurrentX.current - touchStartX.current;
    if (offset < -100) {
      onDismiss(toast.id);
    } else {
      setDragOffset(0);
      setProgress(100);
      startTimers();
    }
  };

  const progressBarColor = styles.progress;

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: isDragging ? `translateX(${dragOffset}px)` : undefined,
        transition: isDragging ? 'none' : 'transform 0.3s ease-out, opacity 0.3s ease-out',
      }}
      className={`pointer-events-auto w-full ${styles.bg} ${styles.border} border-2 rounded-2xl shadow-2xl p-4 flex items-start gap-3 animate-slide-down relative overflow-hidden ${toast.onAction ? 'cursor-pointer' : ''}`}
      onClick={() => {
        // Tapping anywhere on the toast performs its action (e.g. jump to the
        // notifications tab) — the dedicated button stays for discoverability.
        if (!toast.onAction) return;
        toast.onAction();
        onDismiss(toast.id);
      }}
    >
      <div className={`w-10 h-10 rounded-xl ${styles.iconBg} flex items-center justify-center flex-shrink-0`}>
        <Icon className={`w-5 h-5 ${styles.iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-white text-sm">{toast.title}</p>
        <p className="text-sm text-white/90 mt-0.5 leading-relaxed">{toast.message}</p>
        {toast.actionLabel && toast.onAction && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toast.onAction?.();
              onDismiss(toast.id);
            }}
            className={`mt-2 flex items-center gap-1 text-sm font-bold ${styles.accent} hover:underline transition-all`}
          >
            {toast.actionLabel}
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(toast.id);
        }}
        className="p-1.5 rounded-lg text-white/70 hover:bg-white/20 transition-colors flex-shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/10">
        <div
          className={`h-full ${progressBarColor} transition-all duration-75 ease-linear`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((title: string, message: string, type: ToastType = 'info', icon?: typeof Bell, actionLabel?: string, onAction?: () => void, durationMs?: number) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const styles = TYPE_STYLES[type];
    styles.sound();
    vibrate(styles.vibratePattern);
    setToasts((prev) => [...prev.slice(-4), { id, title, message, type, icon, actionLabel, onAction, durationMs }]);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-[45%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] flex flex-col items-center gap-2 w-full max-w-sm px-4 pointer-events-none">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
