-- ============================================================================
-- Momentum+ migration 0061: who did each error actually hit? (Matt,
-- 2026-07-29: "we need a fast and simple way to send an email to users
-- that are affected by it to let them know we are working on the issue.")
--
-- error_reports counts occurrences but not people, so there was no way to
-- contact the members behind an incident. One row per (error, member),
-- written by the error endpoint for signed-in active members only — the
-- same trust boundary that gates alert emails.
-- ============================================================================

create table if not exists public.error_report_hits (
  hash text not null references public.error_reports (hash) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  first_hit timestamptz not null default now(),
  last_hit timestamptz not null default now(),
  hits int not null default 1,
  primary key (hash, profile_id)
);

create index if not exists error_report_hits_profile_idx
  on public.error_report_hits (profile_id);

alter table public.error_report_hits enable row level security;
-- No policies: service-role only, same as error_reports.

-- When the affected members were last sent a "we're on it" notice.
alter table public.error_reports
  add column if not exists users_notified_at timestamptz;
