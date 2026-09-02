-- ============================================================================
-- FIX: a single-draw send was going out as the complete day's results.
--
-- Cause: the sender rebuilt the email server-side and always used kind='eod'
-- (end of day), so the operator's selection was ignored.
--
-- Fix: the browser already builds the exact email it shows in the preview.
-- We now store that message on the run and send those bytes unchanged, so what
-- is previewed is what is sent — for a single draw, a whole day, or a resend.
--
-- Run once in the Supabase SQL editor.
-- ============================================================================

alter table public.blast_runs add column if not exists subject   text;
alter table public.blast_runs add column if not exists html      text;
alter table public.blast_runs add column if not exists text_body text;

-- What was selected, for the History list and for auditing.
alter table public.blast_runs add column if not exists scope_label text;
alter table public.blast_runs add column if not exists scope_kind  text;
alter table public.blast_runs add column if not exists is_resend   boolean not null default false;

-- Verify:
--   select id, scope_kind, scope_label, is_resend, left(subject, 60) as subject
--   from blast_runs order by started_at desc limit 10;
