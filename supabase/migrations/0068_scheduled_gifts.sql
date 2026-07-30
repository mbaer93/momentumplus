-- ============================================================================
-- 0068: scheduled TSLS gifts
--
-- The attendee gift is set up the moment the ticket purchase reaches TSLS,
-- but the free months must not start until the MONTH OF THE EVENT (Matt,
-- 2026-07-30). The account is created quietly right away; the gift itself
-- (membership row, or the Stripe billing pause for paying members) waits
-- here until its start date, when the gift-activate cron applies it.
-- ============================================================================

create table if not exists public.scheduled_gifts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  email text not null,
  name text,
  tier text not null,                 -- gift / vip / tsls_attendee / tsls_vip
  months int not null,
  starts_at timestamptz not null,     -- first of the event month (ET)
  applied_at timestamptz,             -- set once the cron applies it
  result text,                        -- what the activation did (audit aid)
  source text not null default 'tsls',
  created_at timestamptz not null default now()
);

-- The cron's work queue: pending gifts whose start date has arrived.
create index if not exists scheduled_gifts_pending_idx
  on public.scheduled_gifts (starts_at)
  where applied_at is null;

-- One pending gift per member per start date — bridge retries must not
-- stack duplicates.
create unique index if not exists scheduled_gifts_dedup_idx
  on public.scheduled_gifts (profile_id, starts_at)
  where applied_at is null;

-- Service-role only: no client (member or admin browser) reads this table.
alter table public.scheduled_gifts enable row level security;
