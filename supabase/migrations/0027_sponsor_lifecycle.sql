-- Sponsor lifecycle (Matt, 2026-07-17): self-service sponsor onboarding,
-- October-1 annual expiry, and an admin-only archive (never delete).

-- expires_at: end of the current sponsorship term (October 1). Null = no
--   term (e.g. house placeholders). archived_at: manually or automatically
--   retired; archived sponsors are invisible to members, visible to admins
--   under Past Sponsors, and reinstatable.
alter table public.sponsors
  add column if not exists expires_at timestamptz,
  add column if not exists archived_at timestamptz;

-- Pending sponsor-onboarding invites: admin enters the rep's email; the rep
-- fills in the business + their own details via /sponsor-onboarding.
-- Service-role only (admin UIs read through the service client).
create table if not exists public.sponsor_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  tier text not null default 'partner',
  business_name text,
  -- The auth/profile id created (or matched) when the invite was sent.
  invited_profile_id uuid references public.profiles(id) on delete set null,
  -- True when the invite created a brand-new account (the onboarding form
  -- then requires choosing a password).
  account_created boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  sponsor_id uuid references public.sponsors(id) on delete set null
);

alter table public.sponsor_invites enable row level security;
-- No policies: all reads/writes go through the service role.

create index if not exists sponsor_invites_profile_idx
  on public.sponsor_invites (invited_profile_id);

-- Give the already-loaded 2026 roster its October 1, 2026 term end
-- (00:00 ET = 04:00 UTC) so the annual cycle starts correctly.
update public.sponsors
  set expires_at = '2026-10-01T04:00:00Z'
  where expires_at is null and archived_at is null;
