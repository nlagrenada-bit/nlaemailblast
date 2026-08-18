-- National Lotteries Authority — results blast
-- Run in the Supabase SQL editor (or `supabase db push`).

create extension if not exists "pgcrypto";
-- citext must exist before any table below declares an email column with it.
create extension if not exists "citext";

-- ---------------------------------------------------------------- staff

-- Anyone who can sign in is staff; role decides whether they may send.
create table if not exists staff (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null default 'operator'
              check (role in ('operator','approver','admin')),
  created_at  timestamptz not null default now()
);

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid());
$$;

create or replace function can_send() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and role in ('approver','admin'));
$$;

-- ------------------------------------------------------------ draw days

-- One row per calendar day. Lets you record a disruption (hurricane, national
-- day of mourning, technical fault) and move or cancel individual games.
create table if not exists draw_days (
  draw_date     date primary key,
  status        text not null default 'normal'
                check (status in ('normal','disrupted','cancelled')),
  notice        text,                      -- shown at the top of the blast
  daily_on      boolean,                   -- null = follow the weekly schedule
  cash_pop_on   boolean,
  lotto_on      boolean,
  super6_on     boolean,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ------------------------------------------------------- daily game results

-- Play Way, Pick 3 and Cash 4 for one of the four daily draw periods.
create table if not exists daily_results (
  id             uuid primary key default gen_random_uuid(),
  draw_date      date not null,
  period         text not null check (period in
                 ('mid_morning','midday','mid_afternoon','evening')),

  -- Each game carries its own running draw number. Stored, not derived: when a
  -- draw is postponed or moved to another day the number travels with it.
  play_way_draw_no    bigint,
  pick3_draw_no       bigint,
  cash4_draw_no       bigint,

  play_way_number     smallint check (play_way_number between 1 and 36),
  play_way_multiplier text check (play_way_multiplier in ('FP','2X','3X','5X','7X','10X')),
  play_way_payout     numeric(12,2),

  pick3_digits        smallint[] check (
                        pick3_digits is null or (
                          array_length(pick3_digits,1) = 3
                          and pick3_digits <@ array[0,1,2,3,4,5,6,7,8,9]::smallint[])),
  pick3_multiplier    text check (pick3_multiplier in ('FP','2X','3X','5X','7X','10X')),
  pick3_payout        numeric(12,2),

  cash4_digits        smallint[] check (
                        cash4_digits is null or (
                          array_length(cash4_digits,1) = 4
                          and cash4_digits <@ array[0,1,2,3,4,5,6,7,8,9]::smallint[])),
  cash4_multiplier    text check (cash4_multiplier in ('FP','2X','3X','5X','7X','10X')),
  cash4_payout        numeric(12,2),

  cancelled      boolean not null default false,
  entered_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (draw_date, period)
);

-- ------------------------------------------------------------- cash pop

create table if not exists cash_pop_results (
  id          uuid primary key default gen_random_uuid(),
  draw_date   date not null,
  period      text not null check (period in
              ('kick_off','mid_rush','lunch','after_work','prime_time')),
  draw_no     bigint,
  number      smallint check (number between 1 and 15),
  payout      numeric(12,2),
  cancelled   boolean not null default false,
  entered_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (draw_date, period)
);

-- ---------------------------------------------------------------- lotto

create table if not exists lotto_results (
  draw_date        date primary key,
  draw_no          bigint,
  numbers          smallint[] not null check (array_length(numbers,1) = 5),
  free_ticket_letter char(1) check (free_ticket_letter between 'A' and 'O'),
  match4_winners   integer default 0,
  match4_payout    numeric(12,2),
  match3_winners   integer default 0,
  match3_payout    numeric(12,2),
  jackpot_winners  integer not null default 0,
  jackpot_amount   numeric(14,2),          -- next estimated jackpot
  entered_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- -------------------------------------------------------------- super 6

create table if not exists super6_results (
  draw_date        date primary key,
  draw_no          bigint,
  numbers          smallint[] not null check (array_length(numbers,1) = 6),
  free_ticket_letter char(1) check (free_ticket_letter between 'A' and 'O'),
  match4_winners   integer default 0,
  match4_payout    numeric(12,2),
  match5_winners   integer default 0,
  match5_payout    numeric(12,2),
  jackpot_winners  integer not null default 0,
  jackpot_amount   numeric(14,2),
  entered_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ------------------------------------------------------------ recipients

create table if not exists recipient_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  created_at  timestamptz not null default now()
);

create table if not exists recipients (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null unique,
  full_name     text,
  active        boolean not null default true,
  unsubscribed  boolean not null default false,
  bounced_at    timestamptz,
  notes         text,
  created_at    timestamptz not null default now()
);

create table if not exists recipient_group_members (
  recipient_id uuid references recipients(id) on delete cascade,
  group_id     uuid references recipient_groups(id) on delete cascade,
  primary key (recipient_id, group_id)
);

-- ---------------------------------------------------------------- blasts

create table if not exists blasts (
  id            uuid primary key default gen_random_uuid(),
  draw_date     date not null,
  kind          text not null check (kind in
                ('daily_period','cash_pop','lotto','super6','eod','custom')),
  label         text,                       -- e.g. 'Mid-Morning Draw'
  subject       text not null,
  html          text not null,
  text_body     text not null,
  status        text not null default 'draft'
                check (status in ('draft','queued','sending','sent','failed','cancelled')),
  recipient_count integer default 0,
  sent_count    integer default 0,
  failed_count  integer default 0,
  error         text,
  group_ids     uuid[],
  created_by    uuid references auth.users(id),
  approved_by   uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);

create table if not exists blast_deliveries (
  id           uuid primary key default gen_random_uuid(),
  blast_id     uuid not null references blasts(id) on delete cascade,
  email        citext not null,
  status       text not null default 'pending'
               check (status in ('pending','sent','failed')),
  provider_id  text,
  error        text,
  created_at   timestamptz not null default now()
);
create index if not exists blast_deliveries_blast_idx on blast_deliveries(blast_id);

-- -------------------------------------------------------------- settings

-- Single-row key/value store: letter words, sender identity, asset base URL,
-- default greeting, footer text.
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- --------------------------------------------------------------- touch

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['draw_days','daily_results','cash_pop_results',
                           'lotto_results','super6_results'] loop
    execute format(
      'drop trigger if exists %1$s_touch on %1$s;
       create trigger %1$s_touch before update on %1$s
       for each row execute function touch_updated_at();', t);
  end loop;
end $$;


-- ------------------------------------------------- draw number bookkeeping

-- A draw number may never be used twice for the same game. Partial indexes so
-- rows still under entry (number not yet known) don't collide.
create unique index if not exists daily_play_way_draw_no_uniq
  on daily_results(play_way_draw_no) where play_way_draw_no is not null;
create unique index if not exists daily_pick3_draw_no_uniq
  on daily_results(pick3_draw_no) where pick3_draw_no is not null;
create unique index if not exists daily_cash4_draw_no_uniq
  on daily_results(cash4_draw_no) where cash4_draw_no is not null;
create unique index if not exists cash_pop_draw_no_uniq
  on cash_pop_results(draw_no) where draw_no is not null;
create unique index if not exists lotto_draw_no_uniq
  on lotto_results(draw_no) where draw_no is not null;
create unique index if not exists super6_draw_no_uniq
  on super6_results(draw_no) where draw_no is not null;

-- The highest draw number issued for a game so far, whatever date it sits on.
-- The app calls this to suggest the next number; the operator can override it,
-- which is what makes a postponed or re-sequenced draw straightforward.
create or replace function last_draw_no(game text)
returns bigint language sql stable security definer set search_path = public as $$
  select case game
    when 'play_way' then (select max(play_way_draw_no) from daily_results)
    when 'pick3'    then (select max(pick3_draw_no)    from daily_results)
    when 'cash4'    then (select max(cash4_draw_no)    from daily_results)
    when 'cash_pop' then (select max(draw_no)          from cash_pop_results)
    when 'lotto'    then (select max(draw_no)          from lotto_results)
    when 'super6'   then (select max(draw_no)          from super6_results)
  end;
$$;

-- Every game's next suggested number in one round trip.
create or replace function next_draw_numbers()
returns table(game text, last_no bigint, next_no bigint)
language sql stable security definer set search_path = public as $$
  select g, last_draw_no(g), coalesce(last_draw_no(g), 0) + 1
  from unnest(array['play_way','pick3','cash4','cash_pop','lotto','super6']) as g;
$$;

-- Gaps in a sequence are legitimate after a cancellation, but they should be
-- visible. This lists every break so supervisors can reconcile at month end.
create or replace view draw_number_gaps as
with nums as (
  select 'play_way'::text as game, play_way_draw_no as no, draw_date from daily_results where play_way_draw_no is not null
  union all select 'pick3', pick3_draw_no, draw_date from daily_results where pick3_draw_no is not null
  union all select 'cash4', cash4_draw_no, draw_date from daily_results where cash4_draw_no is not null
  union all select 'cash_pop', draw_no, draw_date from cash_pop_results where draw_no is not null
  union all select 'lotto', draw_no, draw_date from lotto_results where draw_no is not null
  union all select 'super6', draw_no, draw_date from super6_results where draw_no is not null
),
seq as (
  select game, no, draw_date,
         lead(no) over (partition by game order by no) as next_no
  from nums
)
select game,
       no                    as after_draw_no,
       next_no               as before_draw_no,
       next_no - no - 1      as missing_count,
       draw_date             as last_seen_on
from seq
where next_no is not null and next_no - no > 1
order by game, no;

-- ------------------------------------------------------------------ RLS

-- Everything is staff-only. The service-role key used by the Netlify
-- functions bypasses RLS, which is why it must never reach the browser.
do $$
declare t text;
begin
  foreach t in array array['staff','draw_days','daily_results','cash_pop_results',
                           'lotto_results','super6_results','recipients',
                           'recipient_groups','recipient_group_members',
                           'blasts','blast_deliveries','settings'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists staff_read on %I;', t);
    execute format('create policy staff_read on %I for select using (is_staff());', t);
    execute format('drop policy if exists staff_write on %I;', t);
    execute format('create policy staff_write on %I for all using (is_staff()) with check (is_staff());', t);
  end loop;
end $$;

-- Only approvers/admins may flip a blast out of draft.
drop policy if exists blast_send_guard on blasts;
create policy blast_send_guard on blasts for update
  using (is_staff())
  with check (status = 'draft' or can_send());
