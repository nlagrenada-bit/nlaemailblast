-- ============================================================================
-- OVERDUE-DRAW ALERTS
--
-- Records which "this draw has not been emailed" alerts have gone out, so the
-- same person is told ONCE per draw rather than every five minutes until
-- someone deals with it.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

create table if not exists public.overdue_alerts (
  draw_date   date        not null,
  slot        text        not null,       -- e.g. 'daily:evening', 'pop:prime_time', 'lotto'
  notified_at timestamptz not null default now(),
  recipients  text,                        -- who was told, for the record
  primary key (draw_date, slot)
);

alter table public.overdue_alerts enable row level security;

drop policy if exists staff_read on public.overdue_alerts;
create policy staff_read on public.overdue_alerts for select using (is_staff());

-- Defaults, only if not already set.
insert into public.settings (key, value) values
  ('overdue_notify_emails', '[]'::jsonb),     -- who to tell
  ('overdue_minutes',       '30'::jsonb),     -- how late before telling them
  ('overdue_enabled',       'true'::jsonb)
on conflict (key) do nothing;

-- Check:
--   select * from settings where key like 'overdue%';
--   select * from overdue_alerts order by notified_at desc limit 10;
