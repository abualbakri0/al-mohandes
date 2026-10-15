import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Robust online detection:
 * - Listens to browser online/offline events for instant reaction.
 * - Heartbeat: a lightweight request every 15s confirms real connectivity
 *   (navigator.onLine alone can lie on captive portals / dead Wi-Fi).
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;
  const probeInFlight = useRef(false);
  const consecutiveFailures = useRef(0);
  const requestTimeoutMs = 4000;

  const probe = useCallback(async () => {
    if (probeInFlight.current) return;
    // If the browser already says offline, stay offline.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      consecutiveFailures.current = 0;
      if (isOnlineRef.current) setIsOnline(false);
      return;
    }
    probeInFlight.current = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // Lightweight Supabase probe (4s timeout).
      // IMPORTANT: supabase-js v2 does NOT throw on network failure — it
      // resolves with { error }. We must inspect the error field, otherwise
      // the app believes it is online forever and the banner never shows.
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      const { error } = await supabase
        .from('app_settings')
        .select('id')
        .limit(1)
        .abortSignal(controller.signal);
      if (error) throw error;
      consecutiveFailures.current = 0;
      if (!isOnlineRef.current) setIsOnline(true);
    } catch {
      // Detect an unusable connection promptly, rather than waiting for the
      // next 15-second heartbeat after a single failed request.
      consecutiveFailures.current += 1;
      if (isOnlineRef.current) setIsOnline(false);
    } finally {
      if (timeout) clearTimeout(timeout);
      probeInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      // Browser says online — verify with a real probe.
      probe();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    // Initial probe + periodic heartbeat.
    probe();
    const interval = setInterval(probe, 15000);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [probe]);

  return isOnline;
}
