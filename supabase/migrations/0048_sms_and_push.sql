-- ============================================================================
-- Momentum+ migration 0048: SMS announcements + Web Push
-- 1) announcement_deliveries.sms_at — journals per-member SMS sends so a
--    resumed announcement never texts the same member twice.
-- 2) push_subscriptions — one row per device that enabled push. Members
--    manage their own rows; sends happen server-side (service role).
-- ============================================================================

alter table announcement_deliveries
  add column if not exists sms_at timestamptz;

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  -- The push endpoint URL uniquely identifies a device subscription. A
  -- device re-subscribing (or a shared browser switching accounts) simply
  -- takes the row over.
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index push_subscriptions_profile_idx on push_subscriptions (profile_id);

alter table push_subscriptions enable row level security;

create policy "push subscriptions: read own"
  on push_subscriptions for select
  using (profile_id = auth.uid());

create policy "push subscriptions: delete own"
  on push_subscriptions for delete
  using (profile_id = auth.uid());

-- Inserts/updates go through the server (service role) after auth so an
-- endpoint being claimed by a different signed-in account is handled
-- cleanly; no member-facing insert policy on purpose.
