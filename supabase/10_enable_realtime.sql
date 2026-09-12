-- ============================================================================
-- ENABLE REALTIME ON THE RESULTS TABLES
--
-- Supabase only streams changes for tables added to the supabase_realtime
-- publication. Without this the app subscribes successfully but never receives
-- anything, which looks exactly like the feature not working.
--
-- Run once in the Supabase SQL editor.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'daily_results', 'cash_pop_results', 'lotto_results', 'super6_results',
    'draw_days', 'blast_runs'
  ] loop
    -- add_table errors if the table is already in the publication, so ignore that
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'realtime enabled: %', t;
    exception when duplicate_object then
      raise notice 'already enabled: %', t;
    end;
  end loop;
end $$;

-- REPLICA IDENTITY FULL makes the OLD row available on updates and deletes.
-- Without it a DELETE arrives with only the primary key, so the client cannot
-- tell which draw_date it belonged to and the filter never matches.
alter table public.daily_results    replica identity full;
alter table public.cash_pop_results replica identity full;
alter table public.lotto_results    replica identity full;
alter table public.super6_results   replica identity full;
alter table public.draw_days        replica identity full;

-- Check what is streaming:
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' order by tablename;
