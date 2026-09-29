-- Lotto and Super 6 get a longer allowance before a late-results alert:
-- prize tiers and the new jackpot are worked out after the draw.
-- Run once. Safe to re-run; leaves an existing value alone.
insert into public.settings (key, value)
values ('overdue_minutes_jackpot', '70'::jsonb)
on conflict (key) do nothing;
