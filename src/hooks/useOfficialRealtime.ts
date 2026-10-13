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
} from '@/lib/supabase';
import { shortName, consumeSelfWrite } from '@/lib/api';
import { formatTime12 } from '@/lib/time';
import { emitOfficialEvent, type ToastFn } from '@/lib/officialEmit';
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
    ) =>
      emitOfficialEvent({ table, id, title, body, tab, urgent, evt, showToast: toastRef.current, goToTab: goRef.current });

    const channel = supabase
      .channel('official-notify-all')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        const row = payload.new as AppNotification;
        if (!matchesDept(row.department, deptRef.current)) return;
        const urgent = row.notification_type === 'postponement';
        emitNow('notifications', row.id, `${urgent ? '🚨 ' : '🔔 '}${row.title}`, row.message, 'notifications', urgent);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications' }, (payload) => {
        const row = payload.new as AppNotification;
        if (!matchesDept(row.department, deptRef.current)) return;
        if (consumeSelfWrite('notifications', row.id)) return;
        if (!isMeaningfulUpdate('notifications', payload.old as Record<string, unknown>, row as unknown as Record<string, unknown>)) return;
        const urgent = row.notification_type === 'postponement';
        emitNow('notifications', row.id, `${urgent ? '🚨 ' : '🔕 '}${row.title}`, `تم تعديل الإشعار — ${row.message}`, 'notifications', urgent, 'update');
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notifications' }, (payload) => {
        const oldRow = payload.old as AppNotification;
        if (!oldRow?.id) return;
        if (consumeSelfWrite('notifications', oldRow.id)) return;
        emitNow('notifications', oldRow.id, '🗑️ حُذف إشعار', 'أُزال إشعار من القائمة', 'notifications', false, 'delete');
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lectures' }, (payload) => {
        const row = payload.new as Lecture;
        if (!matchesDept(row.department, deptRef.current)) return;
        const when = row.is_holiday ? ' (إجازة)' : ` — يوم ${row.day} الساعة ${formatTime12(row.start_time)}`;
        const teacher = row.teacher ? ` — م.${row.teacher}` : '';
        emitNow('lectures', row.id, '📚 محاضرة جديدة', `${row.subject}${when}${teacher}`, 'schedule');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lectures' }, (payload) => {
        const row = payload.new as Lecture;
        if (!matchesDept(row.department, deptRef.current)) return;
        if (consumeSelfWrite('lectures', row.id)) return;
        if (!isMeaningfulUpdate('lectures', payload.old as Record<string, unknown>, row as unknown as Record<string, unknown>)) return;
        const when = row.is_holiday ? ' (إجازة)' : ` — يوم ${row.day} الساعة ${formatTime12(row.start_time)}`;
        emitNow('lectures', row.id, '✏️ تعديل محاضرة', `${row.subject}${when}`, 'schedule', false, 'update');
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'lectures' }, (payload) => {
        const oldRow = payload.old as Lecture;
        if (!oldRow?.id) return;
        if (consumeSelfWrite('lectures', oldRow.id)) return;
        emitNow('lectures', oldRow.id, '🗑️ حُذفت محاضرة', 'أُزيلت محاضرة من الجدول', 'schedule', false, 'delete');
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'assignments' }, (payload) => {
        const row = payload.new as Assignment;
        if (!matchesDept(row.department, deptRef.current)) return;
        emitNow('assignments', row.id, '📝 تكليف جديد', `${row.subject}: ${row.title} — التسليم ${row.due_date}`, 'assignments');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'assignments' }, (payload) => {
        const row = payload.new as Assignment;
        if (!matchesDept(row.department, deptRef.current)) return;
        if (consumeSelfWrite('assignments', row.id)) return;
        if (!isMeaningfulUpdate('assignments', payload.old as Record<string, unknown>, row as unknown as Record<string, unknown>)) return;
        emitNow('assignments', row.id, '✏️ تعديل تكليف', `${row.subject}: ${row.title} — التسليم ${row.due_date}`, 'assignments', false, 'update');
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'assignments' }, (payload) => {
        const oldRow = payload.old as Assignment;
        if (!oldRow?.id) return;
        if (consumeSelfWrite('assignments', oldRow.id)) return;
        emitNow('assignments', oldRow.id, '🗑️ حُذف تكليف', 'أُزيل تكليف من القائمة', 'assignments', false, 'delete');
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'exams' }, (payload) => {
        const row = payload.new as Exam;
        if (!matchesDept(row.department, deptRef.current)) return;
        emitNow('exams', row.id, '📋 اختبار جديد', `${row.subject} — يوم ${row.exam_date} الساعة ${formatTime12(row.start_time)}`, 'exams');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'exams' }, (payload) => {
        const row = payload.new as Exam;
        if (!matchesDept(row.department, deptRef.current)) return;
        if (consumeSelfWrite('exams', row.id)) return;
        if (!isMeaningfulUpdate('exams', payload.old as Record<string, unknown>, row as unknown as Record<string, unknown>)) return;
        emitNow('exams', row.id, '✏️ تعديل اختبار', `${row.subject} — يوم ${row.exam_date} الساعة ${formatTime12(row.start_time)}`, 'exams', false, 'update');
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'exams' }, (payload) => {
        const oldRow = payload.old as Exam;
        if (!oldRow?.id) return;
        if (consumeSelfWrite('exams', oldRow.id)) return;
        emitNow('exams', oldRow.id, '🗑️ حُذف اختبار', 'أُزيل اختبار من القائمة', 'exams', false, 'delete');
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reference_materials' }, (payload) => {
        const row = payload.new as ReferenceMaterial;
        if (!matchesDept(row.department, deptRef.current)) return;
        emitNow('references', row.id, '📖 مرجع جديد', row.title, 'references');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'reference_materials' }, (payload) => {
        const row = payload.new as ReferenceMaterial;
        if (!matchesDept(row.department, deptRef.current)) return;
        if (consumeSelfWrite('reference_materials', row.id)) return;
        if (!isMeaningfulUpdate('reference_materials', payload.old as Record<string, unknown>, row as unknown as Record<string, unknown>)) return;
        emitNow('references', row.id, '✏️ تعديل مرجع', row.title, 'references', false, 'update');
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reference_materials' }, (payload) => {
        const oldRow = payload.old as ReferenceMaterial;
        if (!oldRow?.id) return;
        if (consumeSelfWrite('reference_materials', oldRow.id)) return;
        emitNow('references', oldRow.id, '🗑️ حُذف مرجع', 'أُزيل مرجع من القائمة', 'references', false, 'delete');
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'registrations' }, (payload) => {
        if (!devRef.current) return;
        const row = payload.new as Registration;
        emitNow('registrations', row.id, '👤 مسجل جديد', `${shortName(row.name)} — ${row.phone}`, 'registrations');
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'feedback_messages' }, (payload) => {
        if (!devRef.current) return;
        const row = payload.new as FeedbackMessage;
        emitNow('feedback', row.id, '💬 رسالة تواصل جديدة', `من ${shortName(row.sender_name)}: ${row.subject}`, 'feedback');
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
}
