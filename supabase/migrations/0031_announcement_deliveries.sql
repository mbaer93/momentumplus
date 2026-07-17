-- Announcement delivery ledger (Batch G): one row per announcement per
-- member, stamped as each channel goes out. Makes a retried send safe —
-- members who already received the email are skipped instead of emailed
-- twice when a long fan-out times out halfway.

create table if not exists public.announcement_deliveries (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  notified_at timestamptz,
  emailed_at timestamptz,
  primary key (announcement_id, profile_id)
);

alter table public.announcement_deliveries enable row level security;
-- No policies: service-role only.
