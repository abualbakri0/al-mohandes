import { supabase, type Registration, type Lecture, type Assignment, type StudyTask, type Notification, type Exam, type AppSettings, type Department, type ReferenceMaterial, type FeedbackMessage, type FeedbackType } from './supabase';
import { DEV_GRANT_STORAGE_KEY, setDevToken } from './devAuth';
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

/**
 * True when an RPC failed only because the function does not exist yet
 * (backend migration not applied). Every other failure must fail closed —
 * this check is what keeps the legacy fallback from reopening holes.
 */
type RpcErrorLike = { code?: string; message?: string };

function isMissingRpc(error: unknown): boolean {
  const e = error as RpcErrorLike | null | undefined;
  if (!e) return false;
  if (e.code === 'PGRST202' || e.code === '42883') return true;
  const msg = (e.message ?? '').toLowerCase();
  return msg.includes('could not find the function') || msg.includes('does not exist');
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

  // If a password was provided, store it server-side via set_password RPC
  // (the hash is computed in Postgres — never in the browser). Falls back to
  // the legacy client-side write only while the RPC is not deployed yet.
  if (password) {
    const res = await setPasswordViaRpcOrLegacy(phone, password, false);
    if (!res.ok) throw new Error('تعذّر حفظ كلمة المرور');
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
  // Security: password hashes must NEVER be pulled to the client (RPC mode).
  // While the backend migration is not applied yet, the legacy fallback keeps
  // the old client-side hash (only possible while the old SELECT policy on
  // user_passwords still exists); when neither path is available the app runs
  // phone-only — fail-safe, never a hash leak.
  const pwd = await fetchPasswordStatus(phone);
  if (pwd.mode === 'rpc') {
    reg.password_hash = pwd.hasPassword ? 'rpc' : null;
  } else if (pwd.mode === 'legacy') {
    reg.password_hash = pwd.hash;
  } else {
    reg.password_hash = undefined; // feature unavailable → phone-only login
  }
  reg.must_change_password = pwd.mustChange;
  return reg;
}

/**
 * Verify a user password. The normal path compares the hash inside Postgres
 * (verify_password RPC) — the hash never leaves the server. Only while the
 * RPC is not deployed yet does the legacy local comparison run, and only
 * against a hash that was already in hand for that pre-migration mode.
 */
export async function verifyPassword(phone: string, password: string, storedHash: string | null): Promise<boolean> {
  if (!password) return false;
  let data: unknown = null;
  let rpcError: unknown = null;
  try {
    const res = await supabase.rpc('verify_password', { p_phone: phone, p_password: password });
    data = res.data;
    rpcError = res.error;
  } catch (e) {
    rpcError = e;
  }
  if (!rpcError) return data === true;
  if (!isMissingRpc(rpcError)) return false; // transient failure → fail closed

  // Pre-migration fallback (RPC not deployed): compare the legacy hash locally.
  if (storedHash && storedHash !== 'rpc') {
    try {
      return (await hashPassword(password, phone)) === storedHash;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Passwords live in the dedicated `user_passwords` table (keyed by phone).
 * Security model (hardened): hashes NEVER travel to the client. Status checks
 * go through `password_status` RPC, verification through `verify_password`,
 * writes through `set_password` (SECURITY DEFINER on the server).
 */
type PasswordStatus = {
  /**
   * 'rpc'    = checked server-side (hash never fetched);
   * 'legacy' = pre-migration direct read (local hash available for the old
   *            comparison — only reachable while the old SELECT policy exists);
   * 'none'   = password feature unavailable → phone-only login (fail-safe).
   */
  mode: 'rpc' | 'legacy' | 'none';
  hasPassword: boolean;
  mustChange: boolean;
  /** Legacy mode only — the stored hash (never fetched once the RPC exists). */
  hash: string | null;
};

async function fetchPasswordStatus(phone: string): Promise<PasswordStatus> {
  // 1) Preferred: server-side status (no hash ever crosses the wire).
  try {
    const { data, error } = await supabase.rpc('password_status', { p_phone: phone });
    if (!error) {
      const row = data as { has_password?: boolean; must_change?: boolean } | null;
      return {
        mode: 'rpc',
        hasPassword: row ? Boolean(row.has_password) : false,
        mustChange: row ? Boolean(row.must_change) : false,
        hash: null,
      };
    }
    if (!isMissingRpc(error)) {
      // Transient failure — fail closed (password required) instead of
      // dropping everyone into phone-only login.
      return { mode: 'rpc', hasPassword: true, mustChange: false, hash: null };
    }
  } catch {
    return { mode: 'rpc', hasPassword: true, mustChange: false, hash: null };
  }

  // 2) Pre-migration fallback: RPC not deployed → read status directly
  //    (possible only while the old SELECT policy on user_passwords exists).
  try {
    const { data, error } = await supabase
      .from('user_passwords')
      .select('password_hash, must_change_password')
      .eq('phone', phone)
      .limit(1);
    if (!error) {
      const row =
        Array.isArray(data) && data.length > 0
          ? (data[0] as { password_hash?: string | null; must_change_password?: boolean })
          : null;
      return {
        mode: 'legacy',
        hasPassword: Boolean(row?.password_hash),
        mustChange: row ? Boolean(row.must_change_password) : false,
        hash: row?.password_hash ?? null,
      };
    }
    const msg = (error.message ?? '').toLowerCase();
    const denied =
      error.code === '42501' ||
      error.code === 'PGRST301' ||
      msg.includes('permission') ||
      msg.includes('row-level security') ||
      msg.includes('policy');
    if (denied) {
      // SELECT already dropped while the RPC is also missing (partial
      // migration): phone-only — fail-safe, never a hash leak.
      return { mode: 'none', hasPassword: false, mustChange: false, hash: null };
    }
  } catch {
    /* fall through → fail closed */
  }
  return { mode: 'rpc', hasPassword: true, mustChange: false, hash: null };
}

/**
 * Pre-migration write path: hash the password in the browser and upsert it
 * directly. Only reachable while the set_password RPC is not deployed — once
 * RUN-THIS-IN-SUPABASE.sql is executed the INSERT policy on user_passwords is
 * gone too, so this path fails closed instead of writing.
 */
async function upsertPasswordLegacy(phone: string, password: string, mustChange: boolean): Promise<void> {
  const hash = await hashPassword(password, phone);
  const { error } = await supabase
    .from('user_passwords')
    .upsert(
      {
        phone,
        password_hash: hash,
        must_change_password: mustChange,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'phone' },
    );
  if (error) throw error;
}

/**
 * Write a password through the set_password RPC (hash computed in Postgres).
 * Falls back to the legacy client-side write ONLY while the RPC does not
 * exist yet; every other failure returns ok:false (fail closed).
 */
async function setPasswordViaRpcOrLegacy(
  phone: string,
  password: string,
  mustChange: boolean,
  current: string | null = null,
): Promise<{ ok: boolean; reason?: string }> {
  let data: unknown = null;
  let rpcError: unknown = null;
  try {
    const res = await supabase.rpc('set_password', {
      p_phone: phone,
      p_password: password,
      p_must_change: mustChange,
      p_current: current,
    });
    data = res.data;
    rpcError = res.error;
  } catch (e) {
    rpcError = e;
  }

  if (!rpcError) {
    const row = data as { ok?: boolean; reason?: string } | boolean | null;
    if (typeof row === 'boolean') return { ok: row };
    if (row && typeof row === 'object') return { ok: row.ok !== false, reason: row.reason };
    return { ok: true };
  }

  if (isMissingRpc(rpcError)) {
    try {
      await upsertPasswordLegacy(phone, password, mustChange);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: (e as { message?: string })?.message ?? 'legacy_write_failed' };
    }
  }
  return { ok: false, reason: 'network' };
}

/**
 * Set (or change) a user's password and clear the must_change_password flag.
 * Server-side via set_password RPC (hash computed in Postgres).
 */
export async function setUserPassword(id: string, phone: string, password: string): Promise<void> {
  void id;
  const res = await setPasswordViaRpcOrLegacy(phone, password, false);
  if (!res.ok) throw new Error('تعذّر حفظ كلمة المرور');
}

/**
 * Developer-initiated reset: set the user's password to their phone number and
 * force them to create a new password on next login.
 */
export async function resetUserPassword(id: string, phone: string): Promise<void> {
  void id;
  const res = await setPasswordViaRpcOrLegacy(phone, phone, true);
  if (!res.ok) throw new Error('تعذّر إعادة تعيين كلمة المرور');
}

/**
 * Change a user's own password from the settings screen. Verification of the
 * current password happens inside the set_password RPC (it rejects a wrong
 * current password), so no hash is ever compared in the browser — except in
 * the pre-migration legacy fallback, the only path that still holds a local
 * hash and that disappears once RUN-THIS-IN-SUPABASE.sql is executed.
 */
export async function changeOwnPassword(
  id: string,
  phone: string,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  void id;
  if (newPassword.length < 4) {
    return { ok: false, error: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل' };
  }

  // The current password is required whenever one exists — determined without
  // pulling the hash (password_status RPC / legacy status read).
  const status = await fetchPasswordStatus(phone);
  if (status.hasPassword && !currentPassword) {
    return { ok: false, error: 'أدخل كلمة المرور الحالية' };
  }
  if (status.mode === 'legacy' && status.hash && currentPassword) {
    // Pre-migration only: the old flow compared the hash locally.
    const match = (await hashPassword(currentPassword, phone)) === status.hash;
    if (!match) return { ok: false, error: 'كلمة المرور الحالية غير صحيحة' };
  }

  const res = await setPasswordViaRpcOrLegacy(phone, newPassword, false, currentPassword || null);
  if (!res.ok) {
    return {
      ok: false,
      error: res.reason === 'bad_current' ? 'كلمة المرور الحالية غير صحيحة' : 'حدث خطأ أثناء الحفظ. حاول مرة أخرى.',
    };
  }

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
 * Per-student progress SESSION (server-enforced isolation).
 *
 * Section 11 of RUN-THIS-IN-SUPABASE.sql revokes ALL direct anon access to
 * user_assignment_progress / user_study_progress — the RLS policies were
 * USING(true), so an unfiltered REST query used to read every student's rows.
 * From then on every read/write goes through SECURITY DEFINER RPCs that
 * demand a per-user progress key. The key is minted ONLY by
 * progress_session_open() after Postgres verifies the student's password,
 * lives in localStorage per user id (same pattern as the developer grant),
 * and is cleared on logout.
 * ============================================================
 */
const PROGRESS_KEY_PREFIX = 'progress_key_';

function readProgressKey(userId: string): string | null {
  try {
    return localStorage.getItem(PROGRESS_KEY_PREFIX + userId);
  } catch {
    return null;
  }
}

function saveProgressKey(userId: string, key: string): void {
  try {
    localStorage.setItem(PROGRESS_KEY_PREFIX + userId, key);
  } catch {
    /* storage unavailable */
  }
}

/** Logout hygiene — the server keeps the key; the next login re-fetches it. */
export function clearProgressKey(userId: string): void {
  try {
    localStorage.removeItem(PROGRESS_KEY_PREFIX + userId);
  } catch {
    /* ignore */
  }
}

/** True when this device already holds the student's progress key. */
export function hasProgressKey(userId: string): boolean {
  return readProgressKey(userId) !== null;
}

/**
 * Mint (or reuse) this student's progress key. Called at every moment the
 * password is in hand: login, first password creation, and registration.
 * Never throws — while Section 11 is not deployed yet the app simply keeps
 * its pre-migration behaviour (direct table access).
 */
export async function openProgressSession(phone: string, password: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('progress_session_open', {
      p_phone: phone,
      p_password: password,
    });
    if (error) return false; // RPC missing (pre-deployment) or transient failure
    const row = data as { ok?: boolean; user_id?: string; key?: string } | null;
    if (row?.ok && row.user_id && row.key) {
      saveProgressKey(row.user_id, row.key);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * True only once Section 11 is live (progress_fetch answers instead of
 * PGRST202). Used at boot to decide whether a key-less legacy session must
 * re-enter the password once. Offline or not deployed → false, so a flaky
 * network can never lock the user out.
 */
export async function isProgressIsolationDeployed(): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('progress_fetch', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_key: '00000000-0000-0000-0000-000000000000',
      p_kind: 'assignment',
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Run one progress RPC. Returns null when the RPC is not deployed yet so the
 * caller can fall back to its legacy direct path; any other failure (or a
 * rejected key) throws — views keep their local mirror, writes get queued.
 */
async function progressRpc(
  fn: 'progress_fetch' | 'progress_set' | 'progress_reset_mine' | 'progress_reset_all' | 'progress_counts',
  args: Record<string, unknown>,
): Promise<{ ok: boolean; payload: Record<string, unknown> } | null> {
  let data: unknown = null;
  let rpcError: unknown = null;
  try {
    const res = await supabase.rpc(fn, args);
    data = res.data;
    rpcError = res.error;
  } catch (e) {
    rpcError = e;
  }
  if (rpcError) {
    if (isMissingRpc(rpcError)) return null; // Section 11 not deployed → legacy
    throw rpcError; // transient → fail closed (caller queues/retries)
  }
  const payload = (data ?? {}) as Record<string, unknown>;
  return { ok: payload.ok === true, payload };
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
 * ⚠️ Since Section 11 the isolation is ENFORCED by the database: direct anon
 * access is revoked and every query below goes through an RPC that validates
 * (user_id + progress_key). The direct table paths that remain are legacy
 * fallbacks for the pre-deployment window only — they fail closed afterwards.
 * ============================================================
 */

/**
 * Drop a key the server no longer recognises (its `student_keys` row was reset
 * or lost). Without this the device keeps sending a dead key forever: every
 * read throws and every write stays stuck in the offline queue. Clearing it
 * makes the boot gate ask for the password once and mint a fresh key.
 */
function handleRejectedKey(userId: string, payload: Record<string, unknown>): void {
  if (payload.reason === 'bad_key') clearProgressKey(userId);
}

/** This student's completion map: { [assignment_id]: completed }. */
export async function fetchAssignmentProgress(userId: string): Promise<Record<string, boolean>> {
  const key = readProgressKey(userId);
  if (key) {
    const res = await progressRpc('progress_fetch', { p_user_id: userId, p_key: key, p_kind: 'assignment' });
    if (res) {
      if (!res.ok) {
        handleRejectedKey(userId, res.payload);
        throw new Error('progress key rejected');
      }
      return (res.payload.map as Record<string, boolean> | undefined) ?? {};
    }
    // RPC not deployed yet → legacy direct read below.
  }
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
  const key = readProgressKey(userId);
  if (key) {
    const res = await progressRpc('progress_set', {
      p_user_id: userId,
      p_key: key,
      p_kind: 'assignment',
      p_item: assignmentId,
      p_completed: completed,
    });
    if (res) {
      // !ok = pending/unknown item or a rejected key → queue/keep local,
      // exactly like the legacy path's FK/cast error.
      if (!res.ok) {
        handleRejectedKey(userId, res.payload);
        throw new Error('progress write rejected');
      }
      return;
    }
    // RPC not deployed yet → legacy direct upsert below.
  }
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
 * Aggregate only — never exposes which student did what; behind the signed
 * developer token once Section 11 is deployed.
 */
export async function fetchAssignmentProgressCounts(): Promise<Record<string, number>> {
  const token = getDevGrantToken();
  if (token) {
    const res = await progressRpc('progress_counts', { p_kind: 'assignment', p_dev_token: token });
    if (res) {
      if (!res.ok) throw new Error('dev token rejected');
      return (res.payload.counts as Record<string, number> | undefined) ?? {};
    }
    // RPC not deployed yet → legacy direct aggregate below.
  }
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
  const key = readProgressKey(userId);
  if (key) {
    const res = await progressRpc('progress_fetch', { p_user_id: userId, p_key: key, p_kind: 'study' });
    if (res) {
      if (!res.ok) {
        handleRejectedKey(userId, res.payload);
        throw new Error('progress key rejected');
      }
      return (res.payload.map as Record<string, boolean> | undefined) ?? {};
    }
    // RPC not deployed yet → legacy direct read below.
  }
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
  const key = readProgressKey(userId);
  if (key) {
    const res = await progressRpc('progress_set', {
      p_user_id: userId,
      p_key: key,
      p_kind: 'study',
      p_item: taskId,
      p_completed: completed,
    });
    if (res) {
      if (!res.ok) {
        handleRejectedKey(userId, res.payload);
        throw new Error('progress write rejected'); // queued by caller
      }
      return;
    }
    // RPC not deployed yet → legacy direct upsert below.
  }
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
  const key = readProgressKey(userId);
  if (key) {
    const res = await progressRpc('progress_reset_mine', { p_user_id: userId, p_key: key });
    if (res) {
      if (!res.ok) {
        handleRejectedKey(userId, res.payload);
        throw new Error('progress key rejected');
      }
      return;
    }
    // RPC not deployed yet → legacy direct delete below.
  }
  const { error } = await supabase.from('user_study_progress').delete().eq('user_id', userId);
  if (error) throw error;
}

/** Clear EVERY student's progress (developer's manual "تصفير" button). */
export async function resetAllStudyProgress(): Promise<void> {
  const token = getDevGrantToken();
  if (token) {
    const res = await progressRpc('progress_reset_all', { p_dev_token: token });
    if (res) {
      if (!res.ok) throw new Error('dev token rejected');
      return;
    }
    // RPC not deployed yet → legacy direct delete below.
  }
  const { error } = await supabase
    .from('user_study_progress')
    .delete()
    .gte('updated_at', '1970-01-01T00:00:00+00');
  if (error) throw error;
}

/**
 * Developer stats: how many students completed each task → { [task_id]: count }.
 * Aggregate only — never exposes which student did what; behind the signed
 * developer token once Section 11 is deployed.
 */
export async function fetchStudyProgressCounts(): Promise<Record<string, number>> {
  const token = getDevGrantToken();
  if (token) {
    const res = await progressRpc('progress_counts', { p_kind: 'study', p_dev_token: token });
    if (res) {
      if (!res.ok) throw new Error('dev token rejected');
      return (res.payload.counts as Record<string, number> | undefined) ?? {};
    }
    // RPC not deployed yet → legacy direct aggregate below.
  }
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
  teacher: string,
  description: string = ''
): Promise<Exam> {
  const { data, error } = await supabase
    .from('exams')
    .insert({ subject, exam_date, start_time, end_time, location: location || null, department, teacher: teacher || null, description: description.trim() ? description.trim() : null })
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
  // Security: never expose dev_password to the client. The developer code is
  // verified server-side via verify_developer_code RPC; the client only needs
  // the public display fields (level/semester/start date).
  const { data, error } = await supabase
    .from('app_settings')
    .select('id, academic_level, semester, semester_start_date, updated_at')
    .limit(1)
    .single();
  if (error) return null;
  return { ...(data as object), dev_password: '' } as AppSettings;
}

/**
 * ── Developer session (server-signed grant) ────────────────────────────────
 * verify_developer_code RPC answers with an HMAC token bound to dev_password
 * (30-day expiry). verify_dev_token re-checks it server-side on every app
 * boot. Forging localStorage no longer grants the developer UI: a bare legacy
 * `is_dev` flag is honoured only while the RPCs are not deployed yet
 * (pre-migration compatibility); after RUN-THIS-IN-SUPABASE.sql is executed
 * a forged flag is rejected and cleared by validateDeveloperGrant().
 */
const DEV_GRANT_KEY = DEV_GRANT_STORAGE_KEY;

/** Internal: the stored signed grant token (null when absent/unreadable). */
function getDevGrantToken(): string | null {
  try {
    return localStorage.getItem(DEV_GRANT_KEY);
  } catch {
    return null;
  }
}

/** Persist/clear the local developer markers after a successful verification. */
export function setDeveloperSession(active: boolean): void {
  try {
    if (active) {
      localStorage.setItem('is_dev', 'true');
    } else {
      localStorage.removeItem('is_dev');
      localStorage.removeItem(DEV_GRANT_KEY);
      // Clear the stored grant so no further request carries the dev header.
      setDevToken(null);
    }
  } catch {
    /* storage unavailable */
  }
}

/**
 * True only when a server-signed grant token is present. The token cannot be
 * forged without dev_password, so hand-written localStorage data grants
 * nothing — this is the immediate post-login signal, with
 * validateDeveloperGrant() performing the authoritative server-side check.
 */
export function isDeveloperSession(): boolean {
  try {
    return localStorage.getItem(DEV_GRANT_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Validate the stored developer grant against the server (verify_dev_token):
 * - valid → keep it and return true; invalid/expired → clear it, return false.
 * - RPC missing (SQL not executed yet) → honour the legacy `is_dev` flag so
 *   the transition never locks the developer out (old behaviour).
 * - Network failure → only a signed token is trusted; a forged flag never
 *   grants access while offline.
 */
export async function validateDeveloperGrant(): Promise<boolean> {
  let token: string | null = null;
  let legacy = false;
  try {
    token = localStorage.getItem(DEV_GRANT_KEY);
    legacy = localStorage.getItem('is_dev') === 'true';
  } catch {
    /* storage unavailable */
  }
  if (!token && !legacy) return false;
  try {
    const { data, error } = await supabase.rpc('verify_dev_token', { p_token: token ?? '' });
    if (!error) {
      const ok = data === true;
      if (!ok) setDeveloperSession(false);
      return ok;
    }
    if (isMissingRpc(error)) return legacy; // pre-migration compatibility
    return token !== null;                  // transient failure → signed token only
  } catch {
    return token !== null;                  // offline → signed token only
  }
}

/**
 * Verify the developer access code server-side (dev_password never reaches
 * the browser). On success a signed 30-day grant token is stored for
 * validateDeveloperGrant() and attached to every request as `x-dev-token`,
 * which is what authorises writes in RLS. Any failure fails closed.
 */
export async function verifyDeveloperCode(code: string): Promise<boolean> {
  const trimmed = code.trim();
  if (!trimmed) return false;
  try {
    const { data, error } = await supabase.rpc('verify_developer_code', { p_code: trimmed });
    if (error) return false; // includes the rate-limit rejection → fail closed
    const ok = typeof data === 'string' ? data.length > 0 : data === true;
    if (ok) {
      if (typeof data === 'string' && data.length > 0) {
        setDevToken(data); // also persisted in localStorage (devAuth)
      }
      setDeveloperSession(true);
    }
    return ok;
  } catch {
    return false;
  }
}

export async function updateSettings(updates: Partial<Pick<AppSettings, 'academic_level' | 'semester' | 'semester_start_date'>>): Promise<void> {
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

/**
 * Change the developer code server-side. The CURRENT code is verified inside
 * Postgres (change_dev_code RPC) — dev_password accepts no direct writes from
 * the client, so an attempt without the current code is rejected no matter how
 * it is issued. Every previously issued grant token is signed with the old code
 * and dies with it; on success a fresh 30-day token for the new code is minted
 * immediately so the active session stays developer. Any failure fails closed.
 */
export async function changeDevCode(current: string, next: string): Promise<boolean> {
  const cur = current.trim();
  const nxt = next.trim();
  if (!cur || !nxt || nxt.length < 4) return false;
  try {
    const { data, error } = await supabase.rpc('change_dev_code', { p_current: cur, p_new: nxt });
    if (error) return false;
    const ok = (data as { ok?: unknown } | null)?.ok === true;
    if (ok) {
      // The stored grant token was signed with the previous code and is now
      // dead server-side — replace it before returning to keep the session.
      await verifyDeveloperCode(nxt);
    }
    return ok;
  } catch {
    return false;
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
  fields: Partial<Pick<StudyTask, 'subject' | 'task_type' | 'day' | 'start_time' | 'end_time' | 'department' | 'notes'>>
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
  // ══ الحالة الخاصة: جدول notifications لا يملك سياسة UPDATE في RLS ══
  // (يوجد SELECT/INSERT/DELETE فقط). أي UPDATE مباشر من العميل يُحجب
  // بصمت (0 صفوف، بدون خطأ) — فلا يثبت التعديل، ولا ينطلق trigger الدفع
  // dispatch_push_notifications، فيتوقف الإشعار المنبثق للمستخدمين
  // والتطبيق مغلق. لذلك ننفّذ التعديل كحذف + إدراج بنفس المعرّف (كلاهما
  // مسموح)، فينطلق trigger الإدراج وتصل الإشعارات طبيعياً دون المساس
  // بأي سياسة أمنية.
  const { data: existing, error: readError } = await supabase
    .from('notifications')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw readError;

  const { error: deleteError } = await supabase.from('notifications').delete().eq('id', id);
  if (deleteError) throw deleteError;

  const row = {
    id,
    created_at: existing?.created_at ?? new Date().toISOString(),
    title: fields.title ?? existing?.title ?? '',
    message: fields.message ?? existing?.message ?? '',
    notification_type: fields.notification_type ?? existing?.notification_type ?? 'general',
    department: fields.department !== undefined ? fields.department : (existing?.department ?? null),
  };
  const insertOnce = async () => {
    const { error } = await supabase.from('notifications').insert(row);
    if (error) throw error;
  };
  try {
    await insertOnce();
  } catch (e) {
    // إعادة محاولة واحدة إذا حدث سباق بين الحذف والإدراج.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    try {
      await insertOnce();
    } catch {
      throw e;
    }
  }
}

export async function updateExam(
  id: string,
  fields: Partial<Pick<Exam, 'subject' | 'exam_date' | 'start_time' | 'end_time' | 'location' | 'department' | 'teacher' | 'description'>>
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
