// Shared display path for "new content" alerts (toast + system notification).
// Used by BOTH the Supabase Realtime hook (useOfficialRealtime) and the FCM
// foreground handler (push.ts). markSeen() persists per (table,id) so when both
// sources deliver the same row only the FIRST one shows — no double alerts.

import { getNotificationPrefs } from '@/lib/notificationPrefs';
import { notifyNow, CHANNEL_UPDATES, CHANNEL_ALERTS } from '@/lib/nativeNotifications';
import { bumpAppBadge } from '@/lib/appBadge';
import { markUnseen } from '@/lib/api';
import type { TabId } from '@/components/Navbar';

export type ToastFn = (
  title: string,
  message: string,
  type?: 'info' | 'success' | 'warning' | 'error',
  icon?: typeof import('lucide-react').Bell,
  actionLabel?: string,
  onAction?: () => void,
) => void;

let pruneDone = false;

export function markSeen(table: string, id: string, evt: 'insert' | 'update' | 'delete' = 'insert'): boolean {
  try {
    const k = `mohanndes_notified_${table}_${id}${evt === 'insert' ? '' : `_${evt}`}`;
    if (localStorage.getItem(k)) return false;
    localStorage.setItem(k, '1');
    // Prune old dedup keys so localStorage never fills up (which would make
    // setItem throw and — worse — could silently block future notifications).
    // Keeps only the 400 most recent keys; runs at most once per session.
    if (!pruneDone) {
      pruneDone = true;
      try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('mohanndes_notified_')) keys.push(key);
        }
        if (keys.length > 500) {
          keys.slice(0, keys.length - 400).forEach((key) => {
            try { localStorage.removeItem(key); } catch { /* ignore */ }
          });
        }
      } catch { /* ignore */ }
    }
    return true;
  } catch {
    return true;
  }
}

export type EmitArgs = {
  table: string;
  id: string;
  title: string;
  body: string;
  tab: TabId;
  showToast: ToastFn;
  goToTab: (tab: TabId) => void;
  urgent?: boolean;
  /** Realtime event kind — lets an edit/delete of the same row alert again. */
  evt?: 'insert' | 'update' | 'delete';
  /** Suppress badge increment (e.g. when re-delivering an already-seen event). */
  skipBadge?: boolean;
};

export async function emitOfficialEvent(args: EmitArgs): Promise<void> {
  const { table, id, title, body, tab, showToast, goToTab, urgent = false, evt = 'insert', skipBadge = false } = args;
  const preferences = getNotificationPrefs().contentAlerts;
  if (!preferences) return;
  const seen = markSeen(table, id, evt);
  if (!seen) return;
  // Record the unseen badge for this section so the nav item lights up.
  if (!skipBadge) {
    try { markUnseen(tab); } catch { /* non-fatal */ }
  }
  try {
    // urgent (postponement / alerts) → warning toast, 5s; otherwise info, 3s.
    showToast(title, body, urgent ? 'warning' : 'info', undefined, 'عرض', () => goToTab(tab));
  } catch (toastError) {
    console.warn('[notify] toast failed', toastError);
  }
  try {
    // Bump FIRST so notifyNow() attaches the fresh count as the
    // launcher badge number on the posted notification.
    await bumpAppBadge();
    await notifyNow({
      title,
      body,
      channel: urgent ? CHANNEL_ALERTS : CHANNEL_UPDATES,
      data: { tab },
    });
  } catch (notifyError) {
    console.warn('[notify] native notification failed', notifyError);
  }
}
