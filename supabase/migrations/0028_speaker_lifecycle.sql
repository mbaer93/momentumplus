-- Speaker lifecycle (Matt, 2026-07-17): invite -> self-service onboarding ->
-- Speaker Studio; season ends October 1 of the year AFTER joining; archived
-- speakers (plus their sessions and library items) leave member view but
-- are never deleted.

alter table public.speakers
  add column if not exists expires_at timestamptz,
  add column if not exists archived_at timestamptz,
  -- The speaker's single business-resource page on /resources.
  add column if not exists resource_id uuid references public.resources(id) on delete set null;

-- Library items follow their speaker into the archive.
alter table public.videos
  add column if not exists archived_at timestamptz;

create table if not exists public.speaker_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text,
  invited_profile_id uuid references public.profiles(id) on delete set null,
  account_created boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  speaker_id uuid references public.speakers(id) on delete set null
);
alter table public.speaker_invites enable row level security;
-- No policies: service-role only.

create index if not exists speaker_invites_profile_idx
  on public.speaker_invites (invited_profile_id);

-- Season-rule correction (join year + 1): the 2026 roster loaded earlier
-- runs through October 1, 2027 — prep now, live for the season, down the
-- following October.
update public.sponsors
  set expires_at = '2027-10-01T04:00:00Z'
  where expires_at = '2026-10-01T04:00:00Z' and archived_at is null;
