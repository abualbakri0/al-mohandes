import { WifiOff, CheckCircle2, CloudUpload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQueueCount } from '@/lib/offlineStore';

/**
 * A slim persistent banner that slides down under the navbar when the
 * device loses internet, and briefly shows a "back online" confirmation
 * when connectivity returns. Also shows how many developer edits are
 * waiting to be published when the connection returns.
 */
export default function OfflineBanner({ isOnline }: { isOnline: boolean }) {
  const [showBackOnline, setShowBackOnline] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasOffline = useRef(false);
  const pending = useQueueCount();

  useEffect(() => {
    if (!isOnline) {
      wasOffline.current = true;
      setShowBackOnline(false);
      if (timer.current) clearTimeout(timer.current);
    } else if (wasOffline.current) {
      // Connection just restored — flash a confirmation then hide.
      wasOffline.current = false;
      setShowBackOnline(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setShowBackOnline(false), 3500);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [isOnline]);

  if (isOnline && !showBackOnline) return null;

  const online = isOnline && showBackOnline;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`sticky top-16 z-40 animate-fade-in transition-colors duration-300 ${
        online
          ? 'bg-gradient-to-r from-emerald-500/80 to-green-600/80 backdrop-blur-md'
          : 'bg-gradient-to-r from-rose-500/80 to-red-600/80 backdrop-blur-md'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-center gap-2 text-white text-sm font-medium flex-wrap">
        {online ? (
          <>
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>عاد الاتصال بالإنترنت — تم تحديث البيانات</span>
          </>
        ) : (
          <>
            <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
            </span>
            <WifiOff className="w-4 h-4 flex-shrink-0" />
            <span>لا يتوفر اتصال بالإنترنت — تأكد من اتصالك وحاول مرة أخرى</span>
            {pending > 0 && (
              <span className="flex items-center gap-1 text-xs bg-white/20 rounded-full px-2.5 py-0.5">
                <CloudUpload className="w-3.5 h-3.5" />
                {pending} عملية بانتظار النشر
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
