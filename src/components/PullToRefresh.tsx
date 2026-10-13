import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import { RefreshCw, ArrowDown } from 'lucide-react';

const PULL_THRESHOLD = 90;
const MAX_PULL = 140;

type Props = {
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
};

/**
 * Touch-based "pull down to refresh" wrapper.
 *
 * Only activates when the page is scrolled to the very top
 * (window.scrollY <= 0) so it never hijacks normal scrolling.
 */
export default function PullToRefresh({ onRefresh, children }: Props) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pulling = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const refreshingRef = useRef(false);
  refreshingRef.current = refreshing;

  // Passive listeners can't call preventDefault, so attach the move handler
  // manually with { passive: false } — this makes the pull feel solid and
  // avoids the browser fighting the gesture with its own overscroll.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleMove = (e: TouchEvent) => {
      if (!pulling.current || startY.current === null || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        setPullDistance(0);
        return;
      }
      if (window.scrollY <= 0) {
        const damped = Math.min(dy * 0.45, MAX_PULL);
        setPullDistance(damped);
        if (dy > 10 && e.cancelable) e.preventDefault();
      }
    };
    el.addEventListener('touchmove', handleMove, { passive: false });
    return () => el.removeEventListener('touchmove', handleMove);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (window.scrollY > 0 || refreshingRef.current) return;
    startY.current = e.touches[0].clientY;
    pulling.current = true;
  }, []);

  const handleTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;
    startY.current = null;
    if (pullDistance >= PULL_THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPullDistance(60);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, refreshing, onRefresh]);

  const progress = Math.min(pullDistance / PULL_THRESHOLD, 1);
  const showIndicator = pullDistance > 8 || refreshing;

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="relative"
    >
      {/* Pull indicator */}
      <div
        className="overflow-hidden transition-all duration-150 flex justify-center"
        style={{ height: showIndicator ? 56 : 0, opacity: showIndicator ? 1 : 0 }}
      >
        <div className="flex items-center gap-2 text-sm font-medium text-teal-600 dark:text-teal-400 py-3">
          <span
            className={`w-8 h-8 rounded-full bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 flex items-center justify-center ${
              refreshing ? 'animate-spin' : ''
            }`}
            style={
              refreshing
                ? undefined
                : { transform: `rotate(${progress * 180}deg)` }
            }
          >
            {refreshing ? (
              <RefreshCw className="w-4 h-4" />
            ) : (
              <ArrowDown className="w-4 h-4" />
            )}
          </span>
          {refreshing
            ? 'جاري التحديث...'
            : progress >= 1
              ? 'أفلت للتحديث'
              : 'اسحب للأسفل للتحديث'}
        </div>
      </div>

      <div
        style={
          pullDistance > 0
            ? { transform: `translateY(${pullDistance * 0.35}px)` }
            : undefined
        }
        className="transition-transform duration-150"
      >
        {children}
      </div>
    </div>
  );
}
