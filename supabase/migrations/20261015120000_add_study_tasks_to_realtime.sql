-- Enable Supabase Realtime for study_tasks watched by useOfficialRealtime.ts.
-- Idempotent: skips if already in the supabase_realtime publication.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'study_tasks'
  ) then
    execute 'alter publication supabase_realtime add table public.study_tasks';
    raise notice 'realtime: added public.study_tasks';
  else
    raise notice 'realtime: public.study_tasks already published';
  end if;
end $$;
