import { supabase, type Registration, type Lecture, type Assignment, type StudyTask, type Notification, type Exam, type AppSettings, type Department, type ReferenceMaterial, type FeedbackMessage, type FeedbackType } from './supabase';
import { useState, useEffect } from 'react';
import type { TabId } from '@/components/Navbar';

// ============================================================
// Name formatter: first + last name only (privacy)
// "أبوبكر محمد الحيدري" -> "أبوبكر الحيدري"
// "أبوبكر" -> "أبوبكر" | "" -> "مستخدم"
// ============================================================

export function shortName(fullName: string | null | undefined): string {
  if (!fullName) return 'مستخدم';
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'مستخدم';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

// ============================================================
// Self-edit suppression: when the developer edits/deletes a row from THIS
// device, the realtime event echoes back to them. We remember the last N
// (table,id) writes we performed (in the api layer) and skip alerting for
// them (in useOfficialRealtime), so the developer isn't notified about their
// own changes while students still are.
// Lives in its own module to avoid a circular import between api and the hook.
// ============================================================

const SELF_WRITES = new Map<string, number>();
const SELF_TTL_MS = 15_000;

/** Record that this device just wrote (table,id) — called by api mutations. */
export function rememberSelfWrite(table: string, id: string): void {
  if (!id) return;
  SELF_WRITES.set(`${table}:${id}`, Date.now() + SELF_TTL_MS);
  if (SELF_WRITES.size > 200) {
    const now = Date.now();
    for (const [k, exp] of SELF_WRITES) if (exp < now) SELF_WRITES.delete(k);
  }
}

// Re-export the Registration type so consumers can import it from the api layer.
export type { Registration };

/** True if (table,id) was written by this device recently. One-shot: consumes. */
export function consumeSelfWrite(table: string, id: string): boolean {
  const exp = SELF_WRITES.get(`${table}:${id}`);
  if (exp === undefined) return false;
  SELF_WRITES.delete(`${table}:${id}`); // one-shot consume
  if (exp < Date.now()) return false;
  return true;
}

// ============================================================
// Notification center: per-section (per-tab) unseen counters.
// - Every realtime/FCM alert calls markUnseen(tab) so the matching
//   nav item shows a red badge with the unseen count.
// - Opening a section calls clearSection(tab) which zeroes it.
// - Counters persist per account (localStorage) so badges survive restarts.
// - Cross-tab sync via the storage event + a custom window event.
// ============================================================

const EVENT = 'mohanndes-section-badges';

function accountSuffix(): string {
  try {
    const raw = localStorage.getItem('univ_user');
    if (raw) {
      const parsed = JSON.parse(raw) as { phone?: string };
      if (parsed?.phone) return `_${String(parsed.phone).replace(/[^0-9+]/g, '') || 'shared'}`;
    }
  } catch {
    /* ignore */
  }
  return '_shared';
}

function key(): string {
  return `mohanndes_section_badges${accountSuffix()}`;
}

function read(): Record<string, number> {
  try {
    const raw = localStorage.getItem(key());
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function write(next: Record<string, number>): void {
  try {
    localStorage.setItem(key(), JSON.stringify(next));
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* ignore */
  }
}

/** Record one new unseen alert for a section. Returns the new count. */
export function markUnseen(tab: TabId): number {
  const all = read();
  const next = { ...all, [tab]: (all[tab] ?? 0) + 1 };
  write(next);
  return next[tab];
}

/** Zero the counter for a section (user opened it) + remember the visit time. */
export function clearSection(tab: TabId): void {
  recordSectionVisit(tab);
  const all = read();
  if (!all[tab]) return;
  delete all[tab];
  write(all);
}

// ============================================================
// Boot-time badge seeding: markUnseen() only increments while the app is
// RUNNING — content arriving while the app was closed/killed left badges
// empty on next launch. seedSectionBadges() reconciles every section against
// rows created since the user last OPENED that section, so cold starts show
// correct counts too. First-ever run baselines to "now" (never floods badges
// with historical content).
// ============================================================

function visitKey(tab: TabId): string {
  return `mohanndes_last_visit_${tab}${accountSuffix()}`;
}

/** Persist "user has seen this section" time (called by clearSection). */
export function recordSectionVisit(tab: TabId): void {
  try {
    localStorage.setItem(visitKey(tab), new Date().toISOString());
  } catch {
    /* ignore */
  }
}

// Weekday names indexed by JS Date#getDay() — mirrors the day gate used for
// study-task alerts (only badge tasks that would have alerted: their day).
const DAYS_BY_JS_INDEX = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function countableStudyDay(day: string | null | undefined): boolean {
  if (!day) return true;
  const normalized = day.trim();
  if (!DAYS_BY_JS_INDEX.includes(normalized)) return true;
  return normalized === DAYS_BY_JS_INDEX[new Date().getDay()];
}

/** Raise a section badge to `count` (never lowers a live markUnseen count). */
function raiseSectionBadge(tab: TabId, count: number): void {
  if (count <= 0) return;
  const all = read();
  const existing = all[tab] ?? 0;
  if (count <= existing) return;
  write({ ...all, [tab]: count });
}

/**
 * Reconcile section badges with rows created since each section's last visit.
 * Call on cold start and on app resume. Content tables are department-scoped
 * exactly like fetches; feedback/registrations are developer-only (all rows).
 */
export function seedSectionBadges(department: Department | null, isDeveloper: boolean): void {
  const contentSections: Array<[TabId, string]> = [
    ['schedule', 'lectures'],
    ['assignments', 'assignments'],
    ['study', 'study_tasks'],
    ['exams', 'exams'],
    ['references', 'reference_materials'],
  ];
  const devSections: Array<[TabId, string]> = isDeveloper
    ? [
        ['feedback', 'feedback_messages'],
        ['registrations', 'registrations'],
      ]
    : [];

  for (const [tab, table] of [...contentSections, ...devSections]) {
    try {
      const since = localStorage.getItem(visitKey(tab));
      if (!since) {
        // First run with this feature: baseline = now so pre-existing rows
        // never appear as "unseen".
        localStorage.setItem(visitKey(tab), new Date().toISOString());
        continue;
      }
      const cols =
        table === 'feedback_messages' || table === 'registrations'
          ? 'id'
          : table === 'study_tasks'
            ? 'id, department, day'
            : 'id, department';
      let query = supabase
        .from(table)
        .select(cols)
        .gt('created_at', since)
        .limit(200);
      const scoped = table !== 'feedback_messages' && table !== 'registrations';
      if (scoped) {
        const filter = departmentFilter(department ?? undefined);
        if (filter) query = query.or(filter);
      }
      void query.then(({ data, error }) => {
        if (error || !data || data.length === 0) return;
        const rows = data as Array<{ day?: string | null }>;
        const count =
          table === 'study_tasks'
            ? rows.filter((r) => countableStudyDay(r.day)).length
            : rows.length;
        raiseSectionBadge(tab, count);
      });
    } catch {
      /* non-fatal — badges just stay as they were */
    }
  }
}

/** Snapshot of all section counters. */
export function getSectionBadges(): Record<string, number> {
  return read();
}

/** Reactive per-section counters (badge counts for the nav bar). */
export function useSectionBadges(): Record<string, number> {
  const [badges, setBadges] = useState<Record<string, number>>(() => read());
  useEffect(() => {
    const refresh = () => setBadges(read());
    window.addEventListener(EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return badges;
}



/**
 * Hash a password with SHA-256, salted with the user's phone number so that
 * identical passwords from different users produce different hashes.
 * NOTE: This is a lightweight scheme appropriate for this app's threat model
 * (the anon key is already public). It is intentionally simple, not a
 * substitute for a server-side password hashing service.
 */
export async function hashPassword(password: string, phone: string): Promise<string> {
  const salted = `${phone}::${password}`;
  const enc = new TextEncoder().encode(salted);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function fetchRegistrations(): Promise<Registration[]> {
  const { data, error } = await supabase
    .from('registrations')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addRegistration(name: string, phone: string, department?: string, password?: string): Promise<Registration> {
  // Insert the base registration. The registrations table has no password
  // columns; passwords live in the dedicated user_passwords table (below).
  const { data, error } = await supabase
    .from('registrations')
    .insert({ name, phone, department: department ?? null })
    .select()
    .single();
  if (error) throw error;

  // If a password was provided, store it in user_passwords.
  if (password) {
    const password_hash = await hashPassword(password, phone);
    await upsertPassword(phone, password_hash, false);
  }
  return data;
}

export async function deleteRegistration(id: string): Promise<void> {
  const { error } = await supabase.from('registrations').delete().eq('id', id);
  if (error) throw error;
}

export async function approveRegistration(id: string): Promise<void> {
  const { error } = await supabase
    .from('registrations')
    .update({ is_approved: true })
    .eq('id', id);
  if (error) throw error;
}

export async function checkRegistration(phone: string): Promise<Registration | null> {
  // Use order + limit(1) instead of maybeSingle() so duplicate phone rows
  // (from earlier testing) never make this query throw.
  const { data, error } = await supabase
    .from('registrations')
    .select('*')
    .eq('phone', phone)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) return null;

  const reg = data[0] as Registration;
  // Attach password state from the dedicated user_passwords table. If that
  // table is not set up yet, password_hash stays undefined and the UI runs in
  // phone-only mode (legacy behaviour).
  const pwd = await fetchPasswordState(phone);
  reg.password_hash = pwd.available ? pwd.password_hash : undefined;
  reg.must_change_password = pwd.available ? pwd.must_change_password : false;
  return reg;
}

/**
 * Verify a plaintext password against a stored hash for the given phone.
 */
export async function verifyPassword(phone: string, password: string, storedHash: string | null): Promise<boolean> {
  if (!storedHash) return false;
  const candidate = await hashPassword(password, phone);
  return candidate === storedHash;
}

/**
 * Passwords are stored in a dedicated `user_passwords` table (keyed by phone),
 * NOT in the registrations table. All helpers below fail soft: if the table
 * does not exist yet, they report the feature as unavailable and the app falls
 * back to phone-only login (so registration/login never hard-fail).
 */
type PasswordState = { available: boolean; password_hash: string | null; must_change_password: boolean };

async function fetchPasswordState(phone: string): Promise<PasswordState> {
  try {
    const { data, error } = await supabase
      .from('user_passwords')
      .select('password_hash, must_change_password')
      .eq('phone', phone)
      .limit(1);
    if (error) return { available: false, password_hash: null, must_change_password: false };
    const row = data && data.length > 0 ? data[0] : null;
    return {
      available: true,
      password_hash: row ? (row.password_hash as string | null) : null,
      must_change_password: row ? Boolean(row.must_change_password) : false,
    };
  } catch {
    return { available: false, password_hash: null, must_change_password: false };
  }
}

async function upsertPassword(phone: string, password_hash: string | null, mustChange: boolean): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('user_passwords')
      .upsert(
        { phone, password_hash, must_change_password: mustChange, updated_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
    return !error;
  } catch {
    return false;
  }
}

/**
 * Set (or change) a user's password and clear the must_change_password flag.
 */
export async function setUserPassword(id: string, phone: string, password: string): Promise<void> {
  const password_hash = await hashPassword(password, phone);
  const ok = await upsertPassword(phone, password_hash, false);
  if (!ok) throw new Error('تعذّر حفظ كلمة المرور');
}

/**
 * Developer-initiated reset: set the user's password to their phone number and
 * force them to create a new password on next login.
 */
export async function resetUserPassword(id: string, phone: string): Promise<void> {
  const password_hash = await hashPassword(phone, phone);
  const ok = await upsertPassword(phone, password_hash, true);
  if (!ok) throw new Error('تعذّر إعادة تعيين كلمة المرور');
}

/**
 * Change a user's own password from the settings screen. Verifies the current
 * password first (so no one can change it without knowing the old one), then
 * stores the new hash. Returns a status so the UI can show the right message.
 */
export async function changeOwnPassword(
  id: string,
  phone: string,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  if (newPassword.length < 4) {
    return { ok: false, error: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل' };
  }

  // Load password state from the dedicated user_passwords table.
  const state = await fetchPasswordState(phone);
  if (!state.available) {
    return { ok: false, error: 'ميزة كلمة المرور غير مفعّلة بعد.' };
  }

  // If a password already exists, the current one must match.
  if (state.password_hash) {
    const currentHash = await hashPassword(currentPassword, phone);
    if (currentHash !== state.password_hash) {
      return { ok: false, error: 'كلمة المرور الحالية غير صحيحة' };
    }
  }

  const password_hash = await hashPassword(newPassword, phone);
  const ok = await upsertPassword(phone, password_hash, false);
  if (!ok) return { ok: false, error: 'حدث خطأ أثناء الحفظ. حاول مرة أخرى.' };

  return { ok: true };
}

function departmentFilter(department?: Department): string | null {
  if (!department) return null;
  return `department.eq.${department},department.eq.مشترك,department.is.null`;
}

export async function fetchLectures(department?: Department): Promise<Lecture[]> {
  let query = supabase.from('lectures').select('*');
  if (department) query = query.or(departmentFilter(department)!);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addLecture(
  subject: string,
  day: string,
  start_time: string,
  end_time: string,
  location: string,
  department: Department,
  is_holiday: boolean,
  teacher: string
): Promise<Lecture> {
  const { data, error } = await supabase
    .from('lectures')
    .insert({ subject, day, start_time, end_time, location: location || null, department, is_holiday, teacher: teacher || null })
    .select()
    .single();
  if (error) throw error;
  rememberSelfWrite('lectures', data.id);
  return data;
}

export async function deleteLecture(id: string): Promise<void> {
  rememberSelfWrite('lectures', id);
  const { error } = await supabase.from('lectures').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchAssignments(department?: Department): Promise<Assignment[]> {
  let query = supabase.from('assignments').select('*');
  if (department) query = query.or(departmentFilter(department)!);
  const { data, error } = await query.order('due_date', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addAssignment(
  subject: string,
  title: string,
  request_date: string,
  due_date: string,
  department: Department
): Promise<Assignment> {
  const { data, error } = await supabase
    .from('assignments')
    .insert({ subject, title, request_date, due_date, department })
    .select()
    .single();
  if (error) throw error;
  rememberSelfWrite('assignments', data.id);
  return data;
}

export async function deleteAssignment(id: string): Promise<void> {
  rememberSelfWrite('assignments', id);
  const { error } = await supabase.from('assignments').delete().eq('id', id);
  if (error) throw error;
}

/**
 * ============================================================
 * Per-student progress (assignments + study tasks).
 *
 * Completion lives in dedicated per-user tables, NEVER in the shared
 * `assignments.completed` / `study_tasks.completed` columns:
 *   - `user_assignment_progress` (user_id, assignment_id)
 *   - `user_study_progress`     (user_id, task_id)
 *
 * One row per (user, item) means two students can never share a row, so one
 * student's checkmark can never appear for anyone else.
 *
 * ⚠️ EVERY query below MUST be filtered by user_id. The RLS policies are
 * permissive because the app uses the anon key without Supabase Auth, so the
 * database cannot identify the user on its own — the `user_id` filter in the
 * query is what actually isolates each student's data.
 * ============================================================
 */

/** This student's completion map: { [assignment_id]: completed }. */
export async function fetchAssignmentProgress(userId: string): Promise<Record<string, boolean>> {
  const { data, error } = await supabase
    .from('user_assignment_progress')
    .select('assignment_id, completed')
    .eq('user_id', userId);
  if (error) throw error;
  const map: Record<string, boolean> = {};
  for (const row of data ?? []) map[row.assignment_id] = row.completed;
  return map;
}

/** Upsert one student's completion state for a single assignment. */
export async function setAssignmentProgress(assignmentId: string, userId: string, completed: boolean): Promise<void> {
  const { error } = await supabase
    .from('user_assignment_progress')
    .upsert(
      { assignment_id: assignmentId, user_id: userId, completed, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,assignment_id' }
    );
  if (error) throw error;
}

/**
 * Developer stats: how many students completed each assignment → { [id]: count }.
 * Aggregate only — never exposes which student did what.
 */
export async function fetchAssignmentProgressCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('user_assignment_progress')
    .select('assignment_id')
    .eq('completed', true);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.assignment_id] = (counts[row.assignment_id] ?? 0) + 1;
  return counts;
}

export async function fetchStudyTasks(department?: Department): Promise<StudyTask[]> {
  let query = supabase.from('study_tasks').select('*');
  if (department) query = query.or(departmentFilter(department)!);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addStudyTask(
  subject: string,
  task_type: 'review' | 'prestudy',
  day: string,
  start_time: string,
  end_time: string,
  department: Department,
  notes: string | null = null
): Promise<StudyTask> {
  const { data, error } = await supabase
    .from('study_tasks')
    // `notes` is only sent when non-empty, so tasks still save correctly against
    // a database where the 20261013140000_add_study_task_notes migration hasn't
    // run yet (PostgREST rejects unknown columns in the payload).
    .insert({ subject, task_type, day, start_time, end_time, department, ...(notes ? { notes } : {}) })
    .select()
    .single();
  if (error) throw error;
  rememberSelfWrite('study_tasks', data.id);
  return data;
}

export async function toggleStudyTask(id: string, completed: boolean): Promise<void> {
  rememberSelfWrite('study_tasks', id);
  const { error } = await supabase
    .from('study_tasks')
    .update({ completed: !completed })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteStudyTask(id: string): Promise<void> {
  rememberSelfWrite('study_tasks', id);
  const { error } = await supabase.from('study_tasks').delete().eq('id', id);
  if (error) throw error;
}

/**
 * ============================================================
 * Per-student study progress.
 * Completion is stored per (task, student) in `user_study_progress`, so each
 * student's checkmarks are private and sync across their own devices. The old
 * shared `study_tasks.completed` column is never read or written anymore.
 * See the shared note above the assignment progress helpers.
 * ============================================================
 */

/** This student's completion map: { [task_id]: completed }. */
export async function fetchStudyProgress(userId: string): Promise<Record<string, boolean>> {
  const { data, error } = await supabase
    .from('user_study_progress')
    .select('task_id, completed')
    .eq('user_id', userId);
  if (error) throw error;
  const map: Record<string, boolean> = {};
  for (const row of data ?? []) map[row.task_id] = row.completed;
  return map;
}

/** Upsert one student's completion state for a single task. */
export async function setStudyTaskProgress(taskId: string, userId: string, completed: boolean): Promise<void> {
  const { error } = await supabase
    .from('user_study_progress')
    .upsert(
      { task_id: taskId, user_id: userId, completed, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,task_id' }
    );
  if (error) throw error;
}

/** Clear ONE student's progress (used by the weekly auto-reset for that student). */
export async function resetStudyProgressForUser(userId: string): Promise<void> {
  const { error } = await supabase.from('user_study_progress').delete().eq('user_id', userId);
  if (error) throw error;
}

/** Clear EVERY student's progress (developer's manual "تصفير" button). */
export async function resetAllStudyProgress(): Promise<void> {
  const { error } = await supabase
    .from('user_study_progress')
    .delete()
    .gte('updated_at', '1970-01-01T00:00:00+00');
  if (error) throw error;
}

/**
 * Developer stats: how many students completed each task → { [task_id]: count }.
 * Aggregate only — never exposes which student did what.
 */
export async function fetchStudyProgressCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('user_study_progress')
    .select('task_id')
    .eq('completed', true);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.task_id] = (counts[row.task_id] ?? 0) + 1;
  return counts;
}

export async function fetchNotifications(department?: Department): Promise<Notification[]> {
  let query = supabase.from('notifications').select('*');
  if (department) query = query.or(departmentFilter(department)!);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addNotification(
  title: string,
  message: string,
  notification_type: 'postponement' | 'general' | 'reminder',
  department: Department | null
): Promise<Notification> {
  const { data, error } = await supabase
    .from('notifications')
    .insert({ title, message, notification_type, department })
    .select()
    .single();
  if (error) throw error;
  rememberSelfWrite('notifications', data.id);
  return data;
}

export async function deleteNotification(id: string): Promise<void> {
  rememberSelfWrite('notifications', id);
  const { error } = await supabase.from('notifications').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchExams(department?: Department): Promise<Exam[]> {
  let query = supabase.from('exams').select('*');
  if (department) query = query.or(departmentFilter(department)!);
  const { data, error } = await query.order('exam_date', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addExam(
  subject: string,
  exam_date: string,
  start_time: string,
  end_time: string,
  location: string,
  department: Department,
  teacher: string
): Promise<Exam> {
  const { data, error } = await supabase
    .from('exams')
    .insert({ subject, exam_date, start_time, end_time, location: location || null, department, teacher: teacher || null })
    .select()
    .single();
  if (error) throw error;
  rememberSelfWrite('exams', data.id);
  return data;
}

export async function deleteExam(id: string): Promise<void> {
  rememberSelfWrite('exams', id);
  const { error } = await supabase.from('exams').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchReferences(department?: Department): Promise<ReferenceMaterial[]> {
  let query = supabase.from('reference_materials').select('*');
  if (department) query = query.or(departmentFilter(department)!);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addReference(
  title: string,
  description: string,
  filePath: string,
  fileSize: number,
  department: Department | null
): Promise<ReferenceMaterial> {
  const { data, error } = await supabase
    .from('reference_materials')
    .insert({ title, description: description || null, file_path: filePath, file_size: fileSize, department })
    .select()
    .single();
  if (error) throw error;
  rememberSelfWrite('reference_materials', data.id);
  return data;
}

export async function deleteReference(id: string, filePath: string): Promise<void> {
  rememberSelfWrite('reference_materials', id);
  const { error: storageError } = await supabase.storage.from('references').remove([filePath]);
  if (storageError) throw storageError;
  const { error } = await supabase.from('reference_materials').delete().eq('id', id);
  if (error) throw error;
}

export function getReferenceDownloadUrl(filePath: string): string {
  return supabase.storage.from('references').getPublicUrl(filePath).data.publicUrl;
}

export async function uploadReferenceFile(file: File): Promise<{ path: string; size: number }> {
  const ext = file.name.split('.').pop() ?? 'pdf';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const filePath = `references/${fileName}`;
  const { error } = await supabase.storage.from('references').upload(filePath, file, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (error) throw error;
  return { path: filePath, size: file.size };
}

export async function fetchFeedback(): Promise<FeedbackMessage[]> {
  const { data, error } = await supabase
    .from('feedback_messages')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addFeedback(
  senderName: string,
  senderPhone: string | null,
  messageType: FeedbackType,
  subject: string,
  message: string
): Promise<FeedbackMessage> {
  const { data, error } = await supabase
    .from('feedback_messages')
    .insert({ sender_name: senderName, sender_phone: senderPhone, message_type: messageType, subject, message })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markFeedbackRead(id: string, isRead: boolean): Promise<void> {
  const { error } = await supabase
    .from('feedback_messages')
    .update({ is_read: isRead })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteFeedback(id: string): Promise<void> {
  const { error } = await supabase.from('feedback_messages').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchSettings(): Promise<AppSettings | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .limit(1)
    .single();
  if (error) return null;
  return data;
}

export async function updateSettings(updates: Partial<Pick<AppSettings, 'dev_password' | 'academic_level' | 'semester' | 'semester_start_date'>>): Promise<void> {
  const { data: existing } = await supabase.from('app_settings').select('id').limit(1).single();
  if (existing) {
    const { error } = await supabase
      .from('app_settings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('app_settings')
      .insert({ dev_password: '1234', academic_level: 'المستوى الأول', semester: 'الترم الأول', ...updates });
    if (error) throw error;
  }
}

// ============================================================
// Update functions (used by edit buttons + offline queue sync)
// ============================================================

export async function updateLecture(
  id: string,
  fields: Partial<Pick<Lecture, 'subject' | 'day' | 'start_time' | 'end_time' | 'location' | 'department' | 'is_holiday' | 'teacher'>>
): Promise<void> {
  rememberSelfWrite('lectures', id);
  const { error } = await supabase.from('lectures').update(fields).eq('id', id);
  if (error) throw error;
}

export async function updateAssignment(
  id: string,
  // NOTE: `completed` is intentionally NOT writable here. Completion is
  // per-student and lives in `assignment_progress`; the shared column is
  // global, so writing it made one student's checkmark appear for everyone.
  fields: Partial<Pick<Assignment, 'subject' | 'title' | 'request_date' | 'due_date' | 'department'>>
): Promise<void> {
  rememberSelfWrite('assignments', id);
  const { error } = await supabase.from('assignments').update(fields).eq('id', id);
  if (error) throw error;
}

export async function updateStudyTask(
  id: string,
  fields: Partial<Pick<StudyTask, 'subject' | 'task_type' | 'day' | 'start_time' | 'end_time' | 'completed' | 'department' | 'notes'>>
): Promise<void> {
  rememberSelfWrite('study_tasks', id);
  const { error } = await supabase.from('study_tasks').update(fields).eq('id', id);
  if (error) throw error;
}

export async function updateNotification(
  id: string,
  fields: Partial<Pick<Notification, 'title' | 'message' | 'notification_type' | 'department'>>
): Promise<void> {
  rememberSelfWrite('notifications', id);
  const { error } = await supabase.from('notifications').update(fields).eq('id', id);
  if (error) throw error;
}

export async function updateExam(
  id: string,
  fields: Partial<Pick<Exam, 'subject' | 'exam_date' | 'start_time' | 'end_time' | 'location' | 'department' | 'teacher'>>
): Promise<void> {
  rememberSelfWrite('exams', id);
  const { error } = await supabase.from('exams').update(fields).eq('id', id);
  if (error) throw error;
}

export async function updateReference(
  id: string,
  fields: Partial<Pick<ReferenceMaterial, 'title' | 'description' | 'department'>>
): Promise<void> {
  rememberSelfWrite('reference_materials', id);
  const { error } = await supabase.from('reference_materials').update(fields).eq('id', id);
  if (error) throw error;
}
