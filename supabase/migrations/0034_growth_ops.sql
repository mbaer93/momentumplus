-- Growth & operations batch (Matt, 2026-07-17):
-- 1. Member directory contact sharing is strictly opt-in.
-- 2. Failed-payment recovery emails are journaled so each step sends once.
-- 3. Error reports are throttled server-side so one bug never storms Matt's
--    inbox.

alter table public.profiles
  add column if not exists share_contact boolean not null default false;

create table if not exists public.dunning_notices (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  step int not null,               -- 1 = immediate, 2 = day 3, 3 = day 6
  sent_at timestamptz not null default now(),
  primary key (membership_id, step)
);
alter table public.dunning_notices enable row level security;
-- No policies: service-role only.

create table if not exists public.error_reports (
  hash text primary key,           -- fingerprint of message+path
  message text not null,
  path text,
  count int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  last_emailed_at timestamptz
);
alter table public.error_reports enable row level security;
-- No policies: service-role only.
