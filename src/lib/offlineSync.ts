// ============================================================
// Offline queue flush: publishes queued developer operations
// (insert / update / delete) when connectivity returns.
// Also provides runOrQueue(): the single entry point used by
// every view — tries the network first, queues on failure.
// ============================================================

import {
  addLecture, updateLecture, deleteLecture,
  addAssignment, updateAssignment, deleteAssignment,
  addStudyTask, updateStudyTask, deleteStudyTask,
  setStudyTaskProgress, resetStudyProgressForUser, resetAllStudyProgress,
  setAssignmentProgress,
  addNotification, updateNotification, deleteNotification,
  addExam, updateExam, deleteExam,
  addReference, deleteReference, updateReference, uploadReferenceFile,
  addFeedback,
  approveRegistration, deleteRegistration,
} from '@/lib/api';
import { getQueue, dequeue, enqueue, type QueuedOp } from '@/lib/offlineStore';

export type FlushFailure = { label: string; reason: string };
export type FlushResult = { done: number; failed: number; failures: FlushFailure[]; dropped?: number };
export type SaveResult = { status: 'saved' | 'queued'; op: QueuedOp | null };

/** Maximum size (bytes) of a PDF the developer may queue offline. */
export const MAX_OFFLINE_FILE_BYTES = 2 * 1024 * 1024;

function dataUrlToFile(dataUrl: string, fileName: string): File {
  const [meta, base64] = dataUrl.split(',');
  const mime = meta.match(/data:(.*?);/)?.[1] ?? 'application/pdf';
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], fileName, { type: mime });
}

async function executeOp(op: QueuedOp): Promise<void> {
  const p = op.payload ?? {};
  // Guard against malformed/stale queued payloads (e.g. stored by an older
  // app version): fail with a PGRST-tagged message so flushQueue() drops the
  // poison op instead of retrying — and nagging — forever.
  if (op.action === 'update' && (!p.id || typeof p.fields !== 'object' || Object.keys(p.fields ?? {}).length === 0)) {
    throw new Error('PGRST invalid queued update payload (missing id/fields)');
  }
  switch (op.table) {
    case 'lectures':
      if (op.action === 'insert') {
        await addLecture(p.subject, p.day, p.start_time, p.end_time, p.location ?? '', p.department ?? null, p.is_holiday ?? false, p.teacher ?? '');
      } else if (op.action === 'update') {
        await updateLecture(p.id, p.fields);
      } else if (op.action === 'delete') {
        await deleteLecture(p.id);
      }
      break;
    case 'assignments':
      if (op.action === 'insert') {
        await addAssignment(p.subject, p.title, p.request_date, p.due_date, p.department ?? null);
      } else if (op.action === 'update') {
        await updateAssignment(p.id, p.fields);
      } else if (op.action === 'delete') {
        await deleteAssignment(p.id);
      }
      break;
    case 'study_tasks':
      if (op.action === 'insert') {
        await addStudyTask(p.subject, p.task_type, p.day, p.start_time, p.end_time, p.department ?? null, p.notes ?? null);
      } else if (op.action === 'update') {
        // Legacy queue entries from old builds carried `toggleCompleted` and
        // wrote the SHARED study_tasks.completed column — that column is dead
        // (reset by the per-user migration). Drop such entries so they can
        // never revive the shared-checkmark bug; current toggles queue the
        // custom 'set' op handled above, which writes user_study_progress.
        if (p.toggleCompleted === undefined) await updateStudyTask(p.id, p.fields);
      } else if (op.action === 'delete') {
        await deleteStudyTask(p.id);
      }
      break;
    case 'study_progress':
      // Per-student completion queued while offline.
      if (op.action === 'custom' && p.op === 'set') {
        await setStudyTaskProgress(p.taskId, p.userId, p.completed);
      } else if (op.action === 'custom' && p.op === 'resetUser') {
        await resetStudyProgressForUser(p.userId);
      } else if (op.action === 'custom' && p.op === 'resetAll') {
        await resetAllStudyProgress();
      }
      break;
    case 'assignment_progress':
      // Per-student assignment checkmarks queued while offline.
      // Table: user_assignment_progress (one row per user + assignment).
      if (op.action === 'custom' && p.op === 'set') {
        await setAssignmentProgress(p.assignmentId, p.userId, p.completed);
      }
      break;
      // Per-student completion queued while offline.
      if (op.action === 'custom' && p.op === 'set') {
        await setStudyTaskProgress(p.taskId, p.userId, p.completed);
      } else if (op.action === 'custom' && p.op === 'resetUser') {
        await resetStudyProgressForUser(p.userId);
      } else if (op.action === 'custom' && p.op === 'resetAll') {
        await resetAllStudyProgress();
      }
      break;
    case 'notifications':
      if (op.action === 'insert') {
        await addNotification(p.title, p.message, p.notification_type, p.department ?? null);
      } else if (op.action === 'update') {
        await updateNotification(p.id, p.fields);
      } else if (op.action === 'delete') {
        await deleteNotification(p.id);
      }
      break;
    case 'exams':
      if (op.action === 'insert') {
        await addExam(p.subject, p.exam_date, p.start_time, p.end_time, p.location ?? '', p.department ?? null, p.teacher ?? '', p.description ?? '');
      } else if (op.action === 'update') {
        await updateExam(p.id, p.fields);
      } else if (op.action === 'delete') {
        await deleteExam(p.id);
      }
      break;
    case 'reference_materials':
      if (op.action === 'insert') {
        if (!p.dataUrl) throw new Error('reference insert needs file');
        // Rebuild the File from the stored data-URL, upload, then insert the row.
        const file = dataUrlToFile(p.dataUrl, p.fileName ?? 'ref.pdf');
        const { path, size } = await uploadReferenceFile(file);
        await addReference(p.title, p.description ?? '', path, size, p.department ?? null);
      } else if (op.action === 'update') {
        await updateReference(p.id, p.fields);
      } else if (op.action === 'delete') {
        await deleteReference(p.id, p.filePath ?? '');
      }
      break;
    case 'feedback_messages':
      if (op.action === 'insert') {
        await addFeedback(p.sender_name, p.sender_phone ?? null, p.message_type, p.subject, p.message);
      }
      break;
    case 'registration_approve':
      await approveRegistration(p.id);
      break;
    case 'registration_delete':
      await deleteRegistration(p.id);
      break;
    default:
      break;
  }
}

let flushInFlight: Promise<FlushResult> | null = null;

/**
 * True for failures that will NEVER succeed on retry (bad payload, deleted
 * row, RLS/permission denial, table/column missing from the schema cache...).
 * Keeping such "poison" ops queued makes flushQueue() fail forever and nag
 * the user with "تعذر نشر" on every launch.
 *
 * `code` is the PostgREST error code when available (e.g. PGRST205 =
 * "table not found in the schema cache" — usually an unapplied migration).
 * supabase-js exposes it beside `message`, not inside it, so it is checked
 * separately: the message alone reads like a plain English sentence.
 */
function isPermanentFailure(message: string, code?: string): boolean {
  if (code && /^PGRST20[45]$/.test(code)) return true;
  return /invalid input syntax for type uuid|violates (foreign key|not-null|unique|check)|column .* does not exist|could not find the (table|column)|in the schema cache|permission denied|not allowed|row-level security|JWT|PGRST|must be a valid uuid|reference insert needs file/i.test(message);
}

/** Publish every queued op in FIFO order. Keeps retryable failures queued; drops poison ops. */
export function flushQueue(): Promise<FlushResult> {
  // If startup and the reconnect handler both request a flush, share the same
  // result instead of letting one caller mistake an in-progress flush for an
  // empty queue.
  if (flushInFlight) return flushInFlight;

  flushInFlight = (async () => {
    const queue = getQueue();
    let done = 0;
    let failed = 0;
    let dropped = 0;
    const failures: FlushFailure[] = [];
    for (const op of queue) {
      try {
        await executeOp(op);
        dequeue(op.qid);
        done += 1;
      } catch (error) {
        const reason = error instanceof Error
          ? error.message
          : String((error as { message?: string })?.message ?? error ?? 'خطأ غير معروف');
        // PostgREST puts the error code (e.g. PGRST205) outside `message`.
        const code = typeof (error as { code?: unknown })?.code === 'string'
          ? (error as { code?: string }).code
          : undefined;
        if (isPermanentFailure(reason, code)) {
          // Poison op (update of a deleted row, malformed payload, table not
          // in the schema cache…): drop it so it stops failing forever. The
          // server is already the source of truth, so a refresh will restore
          // the correct picture.
          dequeue(op.qid);
          dropped += 1;
          continue;
        }
        failed += 1;
        failures.push({ label: op.label, reason });
        // keep in queue for next retry
      }
    }
    return { done, failed, failures, dropped };
  })().finally(() => {
    flushInFlight = null;
  });

  return flushInFlight;
}

/**
 * Single helper every view uses for mutations:
 * 1. Device offline → queue immediately (no pointless network attempt).
 * 2. Otherwise try the network; on network-level failure → queue instead
 *    of losing the edit. Any other error (validation…) is rethrown.
 */
export async function runOrQueue(
  op: Omit<QueuedOp, 'qid' | 'createdAt'>,
  exec: () => Promise<unknown>
): Promise<SaveResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { status: 'queued', op: enqueue(op) };
  }
  try {
    await exec();
    return { status: 'saved', op: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? '');
    const isNetworkError = /fetch|network|failed to fetch|timeout|abort/i.test(msg);
    if (isNetworkError) {
      return { status: 'queued', op: enqueue(op) };
    }
    throw err;
  }
}
