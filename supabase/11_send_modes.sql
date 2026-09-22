-- ============================================================================
-- SEND MODES: websites first, then email
--
-- A send can now be one of three things:
--     both      update the websites, THEN email          (the default)
--     website   update the websites only
--     email     email only
--
-- The website outcome is recorded on the run so the progress bar can show it
-- as its own stage, separate from the email count.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

alter table public.blast_runs add column if not exists mode text not null default 'both';
alter table public.blast_runs add column if not exists website_sent   integer;
alter table public.blast_runs add column if not exists website_failed integer;
alter table public.blast_runs add column if not exists website_note   text;
alter table public.blast_runs add column if not exists website_done_at timestamptz;

-- Constrain the mode so a typo can never produce a run that does neither.
do $$ begin
  alter table public.blast_runs
    add constraint blast_runs_mode_check check (mode in ('both', 'website', 'email'));
exception when duplicate_object then null;
end $$;

-- Verify:
--   select started_at, mode, website_sent, website_failed, sent_count, status
--   from blast_runs order by started_at desc limit 5;
