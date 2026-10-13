-- ============================================================
--  ⚠️ نفّذ هذا الملف مرة واحدة في Supabase Dashboard → SQL Editor
--  https://supabase.com/dashboard/project/wulycdwgvpriptzubazi/sql/new
--
--  الغرض: جدول واحد bot_kv لتخزين بيانات البوت (إعدادات/مشتركون/إصدار)
--  بشكل دائم على السحابة، فلا تُفقد البيانات عند إعادة النشر على Railway.
-- ============================================================

create table if not exists public.bot_kv (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- تحديث updated_at تلقائياً عند كل تعديل
create or replace function public.bot_kv_touch()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists bot_kv_touch on public.bot_kv;
create trigger bot_kv_touch
  before update on public.bot_kv
  for each row execute function public.bot_kv_touch();

-- أمان: تشغيل RLS. سياسة واسعة تسمح بالقراءة/الكتابة (البوت يعمل بخدمة server-side).
alter table public.bot_kv enable row level security;

drop policy if exists "bot_kv allow all" on public.bot_kv;
create policy "bot_kv allow all"
  on public.bot_kv
  for all
  using (true)
  with check (true);

-- (اختياري) للقراءة من داخل التطبيق عبر anon key، يكفي سياسة SELECT:
-- drop policy if exists "bot_kv read" on public.bot_kv;
-- create policy "bot_kv read" on public.bot_kv for select using (true);
