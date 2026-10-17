// Official realtime watcher — Supabase INSERT → system notification + toast.
// Students: lectures, assignments, exams, references, notifications (dept-filtered).
// Developer: + registrations (مسجل جديد), + feedback_messages (رسالة تواصل).
// Names shown as first + last only (shortName).

import { useEffect, useRef } from 'react';
import {
  supabase,
  type Department,
  type Notification as AppNotification,
  type Registration,
  type FeedbackMessage,
  type Lecture,
  type Assignment,
  type Exam,
  type ReferenceMaterial,
  type StudyTask,
} from '@/lib/supabase';
import { shortName, consumeSelfWrite } from '@/lib/api';
import { formatTime12, formatTimeRange } from '@/lib/time';
import { emitOfficialEvent, markSeen, type ToastFn } from '@/lib/officialEmit';
import type { TabId } from '@/components/Navbar';

type Props = {
  department: Department | null;
  isDeveloper: boolean;
  showToast: ToastFn;
  goToTab: (tab: TabId) => void;
};

function matchesDept(rowDept: Department | null, userDept: Department | null): boolean {
  if (rowDept === null) return true;
  if (!userDept) return true;
  if (rowDept === userDept) return true;
  if (rowDept === 'مشترك') return true;
  return false;
}

// ============================================================
// Self-edit suppression now lives in src/lib/api.ts (rememberSelfWrite /
// consumeSelfWrite) so the api mutation layer can record writes without a
// circular import. Here we only consume those markers via consumeSelfWrite.
// ============================================================

// Only alert on an update if a content field actually moved. With REPLICA
// IDENTITY FULL we get the old row and can ignore no-op updates. Without it
// (old row carries just the id) we can't diff, so we fall back to alerting.
const CONTENT_FIELDS: Record<string, string[]> = {
  lectures: ['subject', 'day', 'start_time', 'end_time', 'location', 'department', 'is_holiday', 'teacher'],
  assignments: ['subject', 'title', 'request_date', 'due_date', 'department'],
  exams: ['subject', 'exam_date', 'start_time', 'end_time', 'location', 'department', 'teacher'],
  notifications: ['title', 'message', 'notification_type', 'department'],
  reference_materials: ['title', 'description', 'department'],
  study_tasks: ['subject', 'task_type', 'day', 'start_time', 'end_time', 'department'],
};

function isMeaningfulUpdate(table: string, oldRow: Record<string, unknown>, newRow: Record<string, unknown>): boolean {
  const fields = CONTENT_FIELDS[table];
  if (!fields) return true;
  const oldKeys = Object.keys(oldRow ?? {});
  if (oldKeys.length <= 1) return true; // replica identity not full → can't diff
  return fields.some((f) => oldRow[f] !== newRow[f]);
}

// Weekday names indexed by JS Date#getDay() (0 = الأحد) — mirrors DAYS in
// @/lib/supabase (which starts at السبت).
const DAYS_BY_JS_INDEX = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

// Study-task alerts (new/edit) are ONLY shown on the task's actual day —
// requirement: adding/editing a task days ahead must not pop up on students'
// devices. Known weekday labels are compared strictly; unknown/empty labels
// fall back to "show" so a data-format change can never silently kill alerts.
function isStudyDayToday(day: string | null | undefined): boolean {
  if (!day) return true;
  const normalized = day.trim();
  if (!DAYS_BY_JS_INDEX.includes(normalized)) return true;
  return normalized === DAYS_BY_JS_INDEX[new Date().getDay()];
}

export function useOfficialRealtime({ department, isDeveloper, showToast, goToTab }: Props) {
  const deptRef = useRef(department);
  const devRef = useRef(isDeveloper);
  const toastRef = useRef(showToast);
  const goRef = useRef(goToTab);

  useEffect(() => { deptRef.current = department; }, [department]);
  useEffect(() => { devRef.current = isDeveloper; }, [isDeveloper]);
  useEffect(() => { toastRef.current = showToast; }, [showToast]);
  useEffect(() => { goRef.current = goToTab; }, [goToTab]);

  useEffect(() => {
    const emitNow = (
      table: string,
      id: string,
      title: string,
      body: string,
      tab: TabId,
      urgent = false,
      evt: 'insert' | 'update' | 'delete' = 'insert',
      durationMs?: number,
    ) =>
      emitOfficialEvent({ table, id, title, body, tab, urgent, evt, durationMs, showToast: toastRef.current, goToTab: goRef.current });

    const channel = supabase
      .channel('official-notify-all')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        const row = payload.new as AppNotification;
        if (!matchesDept(row.department, deptRef.current)) return;
        // Developer self-adds must ALSO alert on this device (no self-suppression for INSERT).
        consumeSelfWrite('notifications', row.id);
        const urgent = row.notification_type === 'postponement';
        emitNow('notifications', row.id, `${urgent ? '🚨 ' : '🔔 '}${row.title}`, row.message, 'notifications', urgent);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications' }, (payload) => {
        const row = payload.new as AppNotification;
        if (!matchesDept(row.department, deptRef.current)) return;
        if (consumeSelfWrite('notifications', row.id)) {
          // Own edit: suppress BOTH paths — mark seen so the parallel FCM
          // copy of this UPDATE can't pop up either.
          markSeen('notifications', row.id, 'update');
          return;
        }
        if (!isMeaningfulUpdate('notifications', payload.old as Record<string, unknown>, row as unknown as Record<string, unknown>)) return;
        const urgent = row.notification_type === 'postponement';
        emitNow('notifications', row.id, `${urgent ? '🚨 ' : '🔕 '}${row.title}`, `تم تعديل الإشعار — ${row.message}`, 'notifications', urgent, 'update');
      })
      // NOTE: DELETE popups are intentionally disabled (requirement: never
      // alert users when something is deleted). No handler is registered for
      // DELETE events on any table — neither here nor on the study channel.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lectures' }, (payload) => {
        const row = payload.new as Lecture;
        if (!matchesDept(row.department, deptRef.current)) return;
        consumeSelfWrite('lectures', row.id);
        const timeRange = row.end_time ? formatTimeRange(row.start_time, row.end_time) : formatTime12(row.start_time);
        const when = row.is_holiday ? ' (إجازة)' : ` — يوم ${row.day} من ${timeRange}`;
        const teacher = row.teacher ? ` — م.${row.teacher}` : '';
        const place = row.location ? ` — القاعة ${row.location}` : '';
        emitNow('lectures', row.id, '📚 محاضرة جديدة', `${row.subject}${when}${teacher}${place}`, 'schedule');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lectures' }, (payload) => {
        const row = payload.new as Lecture;
        if (!matchesDept(row.department, deptRef.current)) return;
        if (consumeSelfWrite('lectures', row.id)) {
          markSeen('lectures', row.id, 'update');
          return;
        }
        if (!isMeaningfulUpdate('lectures', payload.old as Record<string, unknown>, row as unknown as Record<string, unknown>)) return;
        const timeRange = row.end_time ? formatTimeRange(row.start_time, row.end_time) : formatTime12(row.start_time);
        const when = row.is_holiday ? ' (إجازة)' : ` — يوم ${row.day} من ${timeRange}`;
        const teacher = row.teacher ? ` — م.${row.teacher}` : '';
        const place = row.location ? ` — القاعة ${row.location}` : '';
        emitNow('lectures', row.id, '✏️ تعديل محاضرة', `${row.subject}${when}${teacher}${place}`, 'schedule', false, 'update');
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'assignments' }, (payload) => {
        const row = payload.new as Assignment;
        if (!matchesDept(row.department, deptRef.current)) return;
        consumeSelfWrite('assignments', row.id);
        emitNow('assignments', row.id, '📝 تكليف جديد', `${row.subject}: ${row.title} — التسليم ${row.due_date}`, 'assignments');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'assignments' }, (payload) => {
        const row = payload.new as Assignment;
        if (!matchesDept(row.department, deptRef.current)) return;
        if (consumeSelfWrite('assignments', row.id)) {
          markSeen('assignments', row.id, 'update');
          return;
        }
        if (!isMeaningfulUpdate('assignments', payload.old as Record<string, unknown>, row as unknown as Record<string, unknown>)) return;
        emitNow('assignments', row.id, '✏️ تعديل تكليف', `${row.subject}: ${row.title} — التسليم ${row.due_date}`, 'assignments', false, 'update');
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'exams' }, (payload) => {
        const row = payload.new as Exam;
        if (!matchesDept(row.department, deptRef.current)) return;
        consumeSelfWrite('exams', row.id);
        const examTime = row.end_time ? formatTimeRange(row.start_time, row.end_time) : formatTime12(row.start_time);
        const examPlace = row.location ? ` — القاعة ${row.location}` : '';
        const examTeacher = row.teacher ? ` — م.${row.teacher}` : '';
        emitNow('exams', row.id, '📋 اختبار جديد', `${row.subject} — يوم ${row.exam_date} من ${examTime}${examPlace}${examTeacher}`, 'exams');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'exams' }, (payload) => {
        const row = payload.new as Exam;
        if (!matchesDept(row.department, deptRef.current)) return;
        if (consumeSelfWrite('exams', row.id)) {
          markSeen('exams', row.id, 'update');
          return;
        }
        if (!isMeaningfulUpdate('exams', payload.old as Record<string, unknown>, row as unknown as Record<string, unknown>)) return;
        const examTime = row.end_time ? formatTimeRange(row.start_time, row.end_time) : formatTime12(row.start_time);
        const examPlace = row.location ? ` — القاعة ${row.location}` : '';
        const examTeacher = row.teacher ? ` — م.${row.teacher}` : '';
        emitNow('exams', row.id, '✏️ تعديل اختبار', `${row.subject} — يوم ${row.exam_date} من ${examTime}${examPlace}${examTeacher}`, 'exams', false, 'update');
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reference_materials' }, (payload) => {
        const row = payload.new as ReferenceMaterial;
        if (!matchesDept(row.department, deptRef.current)) return;
        consumeSelfWrite('reference_materials', row.id);
        emitNow('references', row.id, '📖 مرجع جديد', row.title, 'references');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'reference_materials' }, (payload) => {
        const row = payload.new as ReferenceMaterial;
        if (!matchesDept(row.department, deptRef.current)) return;
        if (consumeSelfWrite('reference_materials', row.id)) {
          markSeen('reference_materials', row.id, 'update');
          return;
        }
        if (!isMeaningfulUpdate('reference_materials', payload.old as Record<string, unknown>, row as unknown as Record<string, unknown>)) return;
        emitNow('references', row.id, '✏️ تعديل مرجع', row.title, 'references', false, 'update');
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'registrations' }, (payload) => {
        if (!devRef.current) return;
        const row = payload.new as Registration;
        emitNow('registrations', row.id, '🚨 مسجل جديد — يتطلب المراجعة', `${shortName(row.name)} — ${row.phone}`, 'registrations', true, 'insert', 10000);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'feedback_messages' }, (payload) => {
        if (!devRef.current) return;
        const row = payload.new as FeedbackMessage;
        emitNow('feedback', row.id, '💬 رسالة تواصل جديدة', `من ${shortName(row.sender_name)}: ${row.subject}`, 'feedback', true, 'insert', 10000);
      })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[realtime] official channel failed:', status, err);
        }
      });

    // ============================================================
    // ISOLATED channel for study_tasks — CRITICAL, do not merge back
    // into the channel above.
    // History: when study_tasks was missing from the `supabase_realtime`
    // publication, subscribing to it HERE poisoned the whole shared channel
    // (server rejects the join: "Unable to subscribe to changes with given
    // parameters…") and silently dropped every other postgres_changes event —
    // killing ALL popups for everyone. The migration has since been applied,
    // but this isolation stays as a permanent guard: a future publication/RLS
    // mistake on one table can only silence its own alerts, never the rest.
    // ============================================================
    const studyChannel = supabase
      .channel('official-notify-study-tasks')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'study_tasks' }, (payload) => {
        const row = payload.new as StudyTask;
        if (!matchesDept(row.department, deptRef.current)) return;
        consumeSelfWrite('study_tasks', row.id);
        // Only alert on the task's actual day (requirement).
        if (!isStudyDayToday(row.day)) return;
        const kind = row.task_type === 'review' ? 'مراجعة' : 'مذاكرة';
        emitNow('study_tasks', row.id, '📚 مهمة جديدة', `${row.subject} (${kind}) — يوم ${row.day} الساعة ${formatTime12(row.start_time)}`, 'study');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'study_tasks' }, (payload) => {
        const row = payload.new as StudyTask;
        if (!matchesDept(row.department, deptRef.current)) return;
        if (consumeSelfWrite('study_tasks', row.id)) return;
        if (!isMeaningfulUpdate('study_tasks', payload.old as Record<string, unknown>, row as unknown as Record<string, unknown>)) return;
        // Only alert on the task's actual day (requirement).
        if (!isStudyDayToday(row.day)) return;
        emitNow('study_tasks', row.id, '✏️ تعديل مهمة', `${row.subject} — يوم ${row.day} الساعة ${formatTime12(row.start_time)}`, 'study', false, 'update');
      })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[realtime] study_tasks channel failed:', status, err);
        }
      });

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(studyChannel);
    };
  }, []);
}
