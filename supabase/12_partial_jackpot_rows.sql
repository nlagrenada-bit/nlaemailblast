-- ============================================================================
-- ALLOW A JACKPOT DRAW TO BE ENTERED IN THE ORDER IT HAPPENS
--
-- The free ticket letter is drawn BEFORE the numbers. But lotto_results.numbers
-- and super6_results.numbers were NOT NULL, so saving the letter first tried to
-- write a row with no numbers and the database refused it. The operator got an
-- error for doing the natural thing.
--
-- Numbers may now be null while a draw is part-entered. Completeness is still
-- enforced where it matters:
--   - the length check still applies once numbers ARE present
--   - the app refuses to send or publish an incomplete draw (validateDoc)
--   - the public views only show rows that have been published
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

alter table public.lotto_results  alter column numbers drop not null;
alter table public.super6_results alter column numbers drop not null;

-- The length checks keep working: in Postgres a CHECK passes when its result is
-- null, so "array_length(numbers,1) = 5" is satisfied by a null numbers column
-- and still rejects a wrong-length array. Recreated explicitly so the intent is
-- on the record rather than relying on that being remembered.
do $$ begin
  alter table public.lotto_results drop constraint if exists lotto_results_numbers_check;
  alter table public.lotto_results
    add constraint lotto_results_numbers_check
    check (numbers is null or array_length(numbers, 1) = 5);
exception when others then null;
end $$;

do $$ begin
  alter table public.super6_results drop constraint if exists super6_results_numbers_check;
  alter table public.super6_results
    add constraint super6_results_numbers_check
    check (numbers is null or array_length(numbers, 1) = 6);
exception when others then null;
end $$;

-- Check: a part-entered draw is allowed, a wrong-length one is not.
--   insert into lotto_results (draw_date, free_ticket_letter)
--   values ('2099-01-01', 'K');                      -- should succeed
--   insert into lotto_results (draw_date, numbers)
--   values ('2099-01-02', '{1,2,3}');                -- should fail
--   delete from lotto_results where draw_date >= '2099-01-01';
