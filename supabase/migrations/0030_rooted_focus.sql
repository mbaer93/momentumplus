-- Rooted Focus (Matt, 2026-07-17): 90-minute recurring co-working sessions
-- led by the SLC team. They live in the sessions table with program =
-- 'rooted_focus', get their own member tab, can recur (the whole series
-- lands on a member's calendar), and can be hosted by an admin who is not
-- a speaker (host_name).

alter table public.sessions
  add column if not exists program text not null default 'standard',
  add column if not exists recurrence text,
  add column if not exists recurrence_until timestamptz,
  add column if not exists host_name text;

do $$ begin
  alter table public.sessions
    add constraint sessions_program_check
    check (program in ('standard', 'rooted_focus'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.sessions
    add constraint sessions_recurrence_check
    check (recurrence is null or recurrence in ('weekly', 'biweekly', 'monthly'));
exception when duplicate_object then null; end $$;

create index if not exists sessions_program_idx on public.sessions (program);

-- Migration 0020 switched sessions to column-level grants; the new columns
-- are schedule metadata (not join credentials) and must be member-readable.
grant select (program, recurrence, recurrence_until, host_name)
  on public.sessions to anon, authenticated;
