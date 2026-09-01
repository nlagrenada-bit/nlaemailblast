-- Results Desk: throttled blast support
-- Run in Supabase SQL editor. Project ref: wynigmiquitkuujgviqg

-- blast_runs: one row per send attempt. The UI polls this for progress
-- because background functions cannot return a result to the browser.
create table if not exists public.blast_runs (
  id                uuid primary key default gen_random_uuid(),
  draw_date         date not null,
  triggered_by      uuid references auth.users(id),
  status            text not null default 'queued'
                    check (status in ('queued','sending_external','waiting','sending_internal','complete','failed')),
  total_recipients  int  not null default 0,
  sent_count        int  not null default 0,
  failed_count      int  not null default 0,
  error_message     text,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz
);
create index if not exists blast_runs_draw_date_idx on public.blast_runs (draw_date desc);

-- blast_recipients: per-recipient outcome. Crash-safety (resume skips 'sent')
-- and the evidence trail Microsoft asked for.
create table if not exists public.blast_recipients (
  id            bigserial primary key,
  run_id        uuid not null references public.blast_runs(id) on delete cascade,
  email         text not null,
  is_internal   boolean not null default false,
  status        text not null default 'pending'
                check (status in ('pending','sent','failed')),
  error_text    text,
  smtp_response text,
  sent_at       timestamptz,
  unique (run_id, email)
);
create index if not exists blast_recipients_run_idx on public.blast_recipients (run_id, status);

-- RLS: reads for signed-in staff; writes only via the service role.
alter table public.blast_runs       enable row level security;
alter table public.blast_recipients enable row level security;

drop policy if exists "staff read runs" on public.blast_runs;
create policy "staff read runs" on public.blast_runs
  for select to authenticated using (true);

drop policy if exists "staff read recipients" on public.blast_recipients;
create policy "staff read recipients" on public.blast_recipients
  for select to authenticated using (true);
