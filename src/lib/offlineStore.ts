// ============================================================
// Offline-first store: snapshots cache + outbox queue.
// - Every table load saves a snapshot to localStorage.
// - When fetch fails (offline), views fall back to the snapshot.
// - Developer adds/edits/deletes while offline are queued and
//   auto-published (flushQueue) when connectivity returns.
// ============================================================

import { useState, useEffect } from 'react';

export type OfflineTable =
  | 'lectures'
  | 'assignments'
  | 'study_tasks'
  | 'study_progress'
  | 'assignment_progress'
  | 'notifications'
  | 'exams'
  | 'reference_materials'
  | 'feedback_messages'
  | 'registrations';

export type QueuedOp = {
  qid: string;
  table: OfflineTable | 'registration_approve' | 'registration_delete';
  action: 'insert' | 'update' | 'delete' | 'custom';
  /** For insert: full add-fields. For update: { id, fields }. For delete/custom: { id }. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
  /** Arabic description shown in UI, e.g. "إضافة محاضرة: فيزياء". */
  label: string;
  createdAt: string;
};

const SNAP_PREFIX = 'mohanndes_cache_v1_';
const QUEUE_KEY = 'mohanndes_offline_queue_v1';

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full — ignore */
  }
}

function snapKey(table: string, dept?: string): string {
  return `${SNAP_PREFIX}${table}_${dept ?? 'all'}`;
}

// ---------------- Snapshots ----------------

export function saveSnapshot(table: string, dept: string | undefined, rows: unknown[]): void {
  safeWrite(snapKey(table, dept), { savedAt: Date.now(), rows });
}

export function loadSnapshot<T>(table: string, dept: string | undefined): T[] | null {
  const parsed = safeRead<{ savedAt: number; rows: T[] } | null>(snapKey(table, dept), null);
  if (!parsed || !Array.isArray(parsed.rows)) return null;
  return parsed.rows;
}

// ---------------- Queue ----------------

export function getQueue(): QueuedOp[] {
  return safeRead<QueuedOp[]>(QUEUE_KEY, []);
}

export function enqueue(op: Omit<QueuedOp, 'qid' | 'createdAt'>): QueuedOp {
  const full: QueuedOp = {
    ...op,
    qid: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  const q = getQueue();
  q.push(full);
  safeWrite(QUEUE_KEY, q);
  notifyQueueChange();
  return full;
}

export function dequeue(qid: string): void {
  safeWrite(
    QUEUE_KEY,
    getQueue().filter((o) => o.qid !== qid)
  );
  notifyQueueChange();
}

/**
 * Patch a queued operation in place (used when the developer edits a row
 * that was created offline and is still awaiting publication).
 */
export function updateQueuedOp(
  qid: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  patch: { payload?: Record<string, any>; label?: string }
): boolean {
  const q = getQueue();
  const idx = q.findIndex((o) => o.qid === qid);
  if (idx === -1) return false;
  q[idx] = {
    ...q[idx],
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    payload: { ...q[idx].payload, ...(patch.payload ?? {}) },
  };
  safeWrite(QUEUE_KEY, q);
  notifyQueueChange();
  return true;
}

export function pendingCount(): number {
  return getQueue().length;
}

function notifyQueueChange(): void {
  try {
    window.dispatchEvent(new CustomEvent('mohanndes-queue-change'));
  } catch {
    /* ignore */
  }
}

/** Reactive pending-operations count (for banners/badges). */
export function useQueueCount(): number {
  const [count, setCount] = useState(() => pendingCount());
  useEffect(() => {
    const handler = () => setCount(pendingCount());
    window.addEventListener('mohanndes-queue-change', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('mohanndes-queue-change', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  return count;
}

// ---------------- Queue-aware loading ----------------

/** Pending local id prefix for rows created offline. */
export function isPendingId(id: string | null | undefined): boolean {
  return !!id && id.startsWith('pending_');
}

/**
 * Apply queued operations onto rows so views show a truthful
 * offline picture (pending inserts visible, pending deletes hidden).
 */
export function applyQueueToRows<T extends { id: string }>(table: OfflineTable, rows: T[]): (T & { __pending?: boolean })[] {
  const ops = getQueue().filter((o) => o.table === table);
  if (ops.length === 0) return rows;
  const deletedIds = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updatedFields = new Map<string, Record<string, any>>();
  const inserts: (T & { __pending?: boolean })[] = [];
  for (const op of ops) {
    if (op.action === 'delete' && op.payload?.id) {
      deletedIds.add(op.payload.id as string);
    } else if (op.action === 'update' && op.payload?.id) {
      const prev = updatedFields.get(op.payload.id as string) ?? {};
      updatedFields.set(op.payload.id as string, { ...prev, ...(op.payload.fields ?? {}) });
    } else if (op.action === 'insert' && op.payload?.row) {
      inserts.push({ ...(op.payload.row as T), id: `pending_${op.qid}`, __pending: true });
    }
  }
  const out: (T & { __pending?: boolean })[] = [];
  for (const row of rows) {
    if (deletedIds.has(row.id)) continue;
    const fields = updatedFields.get(row.id);
    out.push(fields ? { ...row, ...fields, __pending: true } : row);
  }
  return [...inserts, ...out];
}

export type CacheResult<T> = {
  rows: (T & { __pending?: boolean })[];
  /** true when rows came from the local snapshot (offline or fetch failed). */
  fromCache: boolean;
};

/**
 * Try the network fetcher; on success persist a snapshot.
 * On failure fall back to the snapshot (offline-safe, never empties views).
 */
export async function fetchWithCache<T extends { id: string }>(
  table: OfflineTable,
  dept: string | undefined,
  fetcher: () => Promise<T[]>
): Promise<CacheResult<T>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Some mobile/WebView network failures stall instead of rejecting. Bound
    // the wait so the saved snapshot is shown rather than a permanent spinner.
    const rows = await new Promise<T[]>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Data request timed out')), 8000);
      fetcher().then(resolve, reject);
    });
    saveSnapshot(table, dept, rows);
    return { rows: applyQueueToRows(table, rows), fromCache: false };
  } catch {
    const cached = loadSnapshot<T>(table, dept) ?? [];
    return { rows: applyQueueToRows(table, cached), fromCache: true };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
