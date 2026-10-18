import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
