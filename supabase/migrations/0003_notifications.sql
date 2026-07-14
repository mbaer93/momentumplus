-- ============================================================================
-- Momentum+ migration 0003 (Phase 4): in-app notifications
-- SPEC.md §4: "In-app: notifications bell fed by Supabase realtime."
-- Rows are written by server routes (service role); members read their own
-- and may mark them read. notification_prefs (0001) governs delivery.
-- ============================================================================

create table notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  kind text not null, -- e.g. session_reminder, session_new, recording_ready
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_profile_created_idx
  on notifications (profile_id, created_at desc);

alter table notifications enable row level security;

create policy "notifications: read own"
  on notifications for select
  using (profile_id = auth.uid());

-- Members may only mark their own notifications read (no other writes).
create policy "notifications: mark own read"
  on notifications for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
