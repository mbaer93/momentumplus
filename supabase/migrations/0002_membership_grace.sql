-- ============================================================================
-- Momentum+ migration 0002 (Phase 3)
--
-- 1. Grace-period access semantics (SPEC.md §4):
--      active   → access until expiry (or ongoing when expiry is null)
--      past_due → 7-day grace: access continues until access_expires_at
--      canceled → access until the already-paid period end
--      expired  → no access
--    The GHL webhook writes the correct access_expires_at; these helpers make
--    RLS honor it for past_due/canceled rows instead of cutting access off at
--    the status change.
--
-- 2. import_log — idempotency ledger for the TSLS registration import
--    (unique by email + event year, SPEC.md §4).
-- ============================================================================

-- Single source of truth for "does this membership row grant access?"
create or replace function membership_grants_access(
  status membership_status,
  expires timestamptz
)
returns boolean
language sql
immutable
as $$
  select case
    when status = 'expired' then false
    when expires is null then status = 'active'
    else expires > now()
  end;
$$;

-- Redefine the tier aggregation used by can_view() to honor grace semantics.
create or replace function current_user_tiers()
returns access_tier[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(m.tier), '{}')
  from memberships m
  where m.profile_id = auth.uid()
    and membership_grants_access(m.status, m.access_expires_at);
$$;

create or replace function can_view(required access_level)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when is_admin() then true
    when required = 'admin_only' then false
    when required = 'all_members' then
      exists (
        select 1 from memberships m
        where m.profile_id = auth.uid()
          and membership_grants_access(m.status, m.access_expires_at)
      )
    when required = 'vip_plus' then
      (current_user_tiers() && array['tsls_vip','sub_annual','speaker','admin']::access_tier[])
    else false
  end;
$$;

-- Replace the two member-read policies that embedded the old status check.
drop policy if exists "speakers: read for members" on speakers;
create policy "speakers: read for members"
  on speakers for select
  using (is_admin() or can_view('all_members'));

drop policy if exists "sponsors: read for members" on sponsors;
create policy "sponsors: read for members"
  on sponsors for select
  using (is_admin() or can_view('all_members'));

-- ---------------------------------------------------------------------------
-- import_log — one row per processed TSLS registration (idempotency ledger)
-- ---------------------------------------------------------------------------
create table import_log (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  event_year integer not null,
  registration_type text,
  tier access_tier,
  months integer,
  profile_id uuid references profiles (id) on delete set null,
  processed_at timestamptz not null default now(),
  unique (email, event_year)
);

alter table import_log enable row level security;

-- Service role bypasses RLS (the import runs server-side); admins can inspect.
create policy "import_log: admin read"
  on import_log for select
  using (is_admin());
