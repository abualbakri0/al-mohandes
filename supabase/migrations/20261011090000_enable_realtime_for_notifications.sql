-- Enable Supabase Realtime (postgres_changes) for all tables watched by
-- useOfficialRealtime.ts. Without this, INSERT events never reach clients
-- and no toast / system notification fires.
-- Idempotent: skips tables already in the supabase_realtime publication.

do $$
declare t text;
begin
  foreach t in array array[
    'lectures',
    'assignments',
    'exams',
    'reference_materials',
    'notifications',
    'registrations',
    'feedback_messages'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
      raise notice 'realtime: added %.%', 'public', t;
    else
      raise notice 'realtime: %.% already published', 'public', t;
    end if;
  end loop;
end $$;
