import { createClient } from '@supabase/supabase-js';
import { DEV_TOKEN_HEADER, getDevToken } from './devAuth';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Every Supabase request (REST + Storage) is routed through this wrapper so a
 * valid developer grant travels as the `x-dev-token` header.
 *
 * Server side, RLS policies call `public.dev_token_ok()` which reads that
 * header, so INSERT/UPDATE/DELETE on content is authorised in Postgres instead
 * of trusting whatever the browser claims. Without a token the header is not
 * sent at all → students keep read-only access, exactly as before (no extra
 * CORS preflight, no behaviour change).
 *
 * Scope is limited to `/rest/v1/` and `/storage/v1/` on purpose: the Realtime
 * channel (notifications) is left completely untouched.
 */
const DEV_SCOPED_PATHS = ['/rest/v1/', '/storage/v1/'];

/** HTTP methods that need a developer grant to pass RLS. */
const MUTATING_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'];

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (typeof URL !== 'undefined' && input instanceof URL) return input.toString();
  return (input as Request)?.url ?? '';
}

function requestMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  const explicit = init?.method ?? (input instanceof Request ? input.method : undefined);
  return (explicit ?? 'GET').toUpperCase();
}

/**
 * A rejected write is almost never a real outage: it means the running bundle
 * did not send the grant (an APK built before the header existed, a cached
 * WebView/PWA bundle) or the 30-day grant expired. Record the last rejection so
 * a stale client can be identified on-device (`__devAuthBlocked` in DevTools).
 * The record holds no secret — only the method, URL and HTTP status, which the
 * Network tab already exposes.
 */
export type BlockedWrite = { method: string; url: string; status: number; at: string };

function watchWrite(input: RequestInfo | URL, init: RequestInit | undefined, call: Promise<Response>): Promise<Response> {
  const method = requestMethod(input, init);
  if (!MUTATING_METHODS.includes(method)) return call;
  return call.then((res) => {
    if (res.status === 401 || res.status === 403) {
      const blocked: BlockedWrite = { method, url: requestUrl(input), status: res.status, at: new Date().toISOString() };
      (globalThis as unknown as { __devAuthBlocked?: BlockedWrite }).__devAuthBlocked = blocked;
      // console.* is stripped from production bundles — kept for `npm run dev`.
      console.error('[dev-auth] write blocked (stale bundle or expired grant)', blocked);
    }
    return res;
  });
}

const devAwareFetch: typeof fetch = (input, init) => {
  const token = getDevToken();
  if (!token || !DEV_SCOPED_PATHS.some((path) => requestUrl(input).includes(path))) {
    return watchWrite(input, init, fetch(input, init));
  }

  const baseHeaders = init?.headers ?? (input instanceof Request ? input.headers : undefined);
  const headers = new Headers(baseHeaders);
  headers.set(DEV_TOKEN_HEADER, token);
  return watchWrite(input, init, fetch(input, { ...init, headers }));
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: devAwareFetch },
});

export type Department = 'ميكاترونكس' | 'كهربائية' | 'مشترك';
export const DEPARTMENTS: { id: Department; label: string }[] = [
  { id: 'ميكاترونكس', label: 'هندسة الميكاترونكس' },
  { id: 'كهربائية', label: 'هندسة كهرباء' },
  { id: 'مشترك', label: 'ميكاترونكس + كهرباء' },
];

export const DEPARTMENT_OPTIONS: { id: Department; label: string }[] = [
  { id: 'ميكاترونكس', label: 'ميكاترونكس' },
  { id: 'كهربائية', label: 'كهرباء' },
  { id: 'مشترك', label: 'ميكاترونكس + كهرباء' },
];

export type Registration = {
  id: string;
  name: string;
  phone: string;
  department: Department | null;
  is_approved: boolean;
  password_hash?: string | null;
  must_change_password: boolean;
  created_at: string;
};

export type Lecture = {
  id: string;
  subject: string;
  day: string;
  start_time: string;
  end_time: string;
  location: string | null;
  department: Department | null;
  is_holiday: boolean;
  teacher: string | null;
  created_at: string;
};

export type Assignment = {
  id: string;
  subject: string;
  title: string;
  request_date: string;
  due_date: string;
  completed: boolean;
  department: Department | null;
  created_at: string;
};

export type StudyTask = {
  id: string;
  subject: string;
  task_type: 'review' | 'prestudy';
  day: string;
  start_time: string;
  end_time: string;
  completed: boolean;
  department: Department | null;
  /** شرح اختياري للمهمة (يظهر للطالب أسفل اسم المادة). */
  notes: string | null;
  created_at: string;
};

export type Notification = {
  id: string;
  title: string;
  message: string;
  notification_type: 'postponement' | 'general' | 'reminder';
  department: Department | null;
  created_at: string;
};

export type Exam = {
  id: string;
  subject: string;
  exam_date: string;
  start_time: string;
  end_time: string;
  location: string | null;
  department: Department | null;
  teacher: string | null;
  /** شرح الاختبار (الدروس الداخلة، تعليمات، نطاق المنهج) — يظهر للطلاب في البطاقة. */
  description: string | null;
  created_at: string;
};

export type AppSettings = {
  id: string;
  dev_password: string;
  academic_level: string;
  semester: string;
  semester_start_date: string | null;
  updated_at: string;
};

export function displayDepartment(dept: string): string {
  if (dept === 'مشترك') return 'ميكاترونكس + كهرباء';
  if (dept === 'كهربائية') return 'كهرباء';
  return dept;
}

export const ACADEMIC_LEVELS = [
  'المستوى الأول',
  'المستوى الثاني',
  'المستوى الثالث',
  'المستوى الرابع',
  'المستوى الخامس',
  'المستوى السادس',
  'المستوى السابع',
  'المستوى الثامن',
] as const;

export type ReferenceMaterial = {
  id: string;
  title: string;
  description: string | null;
  file_path: string;
  file_size: number | null;
  department: Department | null;
  created_at: string;
};

export type FeedbackType = 'complaint' | 'suggestion' | 'question' | 'other';

export type FeedbackMessage = {
  id: string;
  sender_name: string;
  sender_phone: string | null;
  message_type: FeedbackType;
  subject: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

export const FEEDBACK_TYPES: { id: FeedbackType; label: string }[] = [
  { id: 'complaint', label: 'شكوى' },
  { id: 'suggestion', label: 'اقتراح' },
  { id: 'question', label: 'استفسار' },
  { id: 'other', label: 'أخرى' },
];

export const SEMESTERS = [
  'الترم الأول',
  'الترم الثاني',
  'الترم الصيفي',
] as const;

export const DAYS = [
  'السبت',
  'الأحد',
  'الإثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
] as const;
