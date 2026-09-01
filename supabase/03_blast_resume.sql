-- Adds last-activity tracking so the resume safety-net can tell a stalled run
-- (chain died) from an actively-running one, avoiding double-sends.
-- Run once in Supabase SQL editor.

alter table public.blast_runs add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_blast_run() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists blast_runs_touch on public.blast_runs;
create trigger blast_runs_touch before update on public.blast_runs
  for each row execute function public.touch_blast_run();
