-- ============================================================================
-- PUBLISH GATE
--
-- Problem: the public results page reads the results tables directly, and the
-- app saves as the operator types. So a half-typed or test result appeared on
-- the public site the instant it was keyed in.
--
-- Fix: results are public only once explicitly PUBLISHED — that is, once a
-- blast has been sent for them, or the operator has pressed "Update the
-- website only". Entering numbers no longer publishes anything.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

alter table daily_results     add column if not exists published_at timestamptz;
alter table cash_pop_results  add column if not exists published_at timestamptz;
alter table lotto_results     add column if not exists published_at timestamptz;
alter table super6_results    add column if not exists published_at timestamptz;

create index if not exists daily_results_published_idx    on daily_results (published_at);
create index if not exists cash_pop_results_published_idx on cash_pop_results (published_at);

-- ---------------------------------------------------------------------------
-- Backfill: everything already on the public site stays there.
--
-- Anything whose day has a completed blast, plus everything imported from
-- history, is treated as already published. Without this the public page would
-- go blank on deploy.
-- ---------------------------------------------------------------------------
update daily_results d set published_at = coalesce(d.updated_at, d.created_at, now())
  where d.published_at is null
    and (d.draw_date < current_date
         or exists (select 1 from blast_runs b
                    where b.draw_date = d.draw_date and b.status = 'complete'));

update cash_pop_results c set published_at = coalesce(c.updated_at, c.created_at, now())
  where c.published_at is null
    and (c.draw_date < current_date
         or exists (select 1 from blast_runs b
                    where b.draw_date = c.draw_date and b.status = 'complete'));

update lotto_results l set published_at = coalesce(l.updated_at, l.created_at, now())
  where l.published_at is null and l.draw_date < current_date;

update super6_results s set published_at = coalesce(s.updated_at, s.created_at, now())
  where s.published_at is null and s.draw_date < current_date;

-- ---------------------------------------------------------------------------
-- Rebuild the public view with the gate applied.
-- ---------------------------------------------------------------------------
drop view if exists public.public_results;

create view public.public_results
with (security_invoker = off) as
with daily as (
  select
    d.draw_date, 'play_way'::text as game, d.period,
    d.play_way_draw_no::bigint as draw_number,
    d.play_way_number::text as numbers,
    d.play_way_multiplier as multiplier,
    null::text as free_ticket_letter,
    case when d.draw_date = public.gd_today() then d.play_way_payout end as payout,
    null::numeric as jackpot
  from daily_results d
  where d.play_way_number is not null and d.published_at is not null
  union all
  select d.draw_date, 'pick3', d.period, d.pick3_draw_no::bigint,
         array_to_string(d.pick3_digits, ','), d.pick3_multiplier, null,
         case when d.draw_date = public.gd_today() then d.pick3_payout end, null
  from daily_results d
  where d.pick3_digits is not null and d.published_at is not null
  union all
  select d.draw_date, 'cash4', d.period, d.cash4_draw_no::bigint,
         array_to_string(d.cash4_digits, ','), d.cash4_multiplier, null,
         case when d.draw_date = public.gd_today() then d.cash4_payout end, null
  from daily_results d
  where d.cash4_digits is not null and d.published_at is not null
),
pops as (
  select c.draw_date, 'cash_pop'::text, c.period, c.draw_no::bigint,
         c.number::text, null::text, null::text,
         case when c.draw_date = public.gd_today() then c.payout end, null::numeric
  from cash_pop_results c
  where c.number is not null
    and coalesce(c.cancelled, false) = false
    and c.published_at is not null
),
jack as (
  select l.draw_date, 'lotto'::text, null::text, l.draw_no::bigint,
         array_to_string(l.numbers, ','), null::text, l.free_ticket_letter,
         null::numeric, l.jackpot_amount
  from lotto_results l where l.numbers is not null and l.published_at is not null
  union all
  select s.draw_date, 'super6', null, s.draw_no::bigint,
         array_to_string(s.numbers, ','), null, s.free_ticket_letter,
         null, s.jackpot_amount
  from super6_results s where s.numbers is not null and s.published_at is not null
)
select * from (
  select * from daily
  union all select * from pops
  union all select * from jack
) all_results
where draw_date >= public.gd_today() - 720
  and draw_date <= public.gd_today();

grant select on public.public_results to anon, authenticated;
revoke insert, update, delete on public.public_results from anon, authenticated;

-- Same gate on the download archive.
drop view if exists public.public_archive;

create view public.public_archive
with (security_invoker = off) as
with daily as (
  select d.draw_date, d.period, 'play_way'::text as game,
         d.play_way_draw_no::bigint as draw_number,
         d.play_way_number::text as numbers,
         d.play_way_multiplier as multiplier,
         null::text as free_ticket_letter, null::numeric as jackpot
  from daily_results d where d.play_way_number is not null and d.published_at is not null
  union all
  select d.draw_date, d.period, 'pick3', d.pick3_draw_no::bigint,
         array_to_string(d.pick3_digits, ','), d.pick3_multiplier, null, null
  from daily_results d where d.pick3_digits is not null and d.published_at is not null
  union all
  select d.draw_date, d.period, 'cash4', d.cash4_draw_no::bigint,
         array_to_string(d.cash4_digits, ','), d.cash4_multiplier, null, null
  from daily_results d where d.cash4_digits is not null and d.published_at is not null
),
pops as (
  select c.draw_date, c.period, 'cash_pop'::text, c.draw_no::bigint,
         c.number::text, null::text, null::text, null::numeric
  from cash_pop_results c
  where c.number is not null and coalesce(c.cancelled,false) = false and c.published_at is not null
),
jack as (
  select l.draw_date, null::text, 'lotto'::text, l.draw_no::bigint,
         array_to_string(l.numbers, ','), null::text, l.free_ticket_letter, l.jackpot_amount
  from lotto_results l where l.numbers is not null and l.published_at is not null
  union all
  select s.draw_date, null, 'super6', s.draw_no::bigint,
         array_to_string(s.numbers, ','), null, s.free_ticket_letter, s.jackpot_amount
  from super6_results s where s.numbers is not null and s.published_at is not null
)
select * from (select * from daily union all select * from pops union all select * from jack) a
where draw_date <= public.gd_today();

grant select on public.public_archive to anon, authenticated;
revoke insert, update, delete on public.public_archive from anon, authenticated;

-- Check what is now public vs held back:
--   select count(*) filter (where published_at is not null) as published,
--          count(*) filter (where published_at is null)     as unpublished
--   from daily_results where draw_date >= current_date - 7;
