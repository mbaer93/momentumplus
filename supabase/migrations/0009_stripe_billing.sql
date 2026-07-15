-- Stripe billing + member levels (uses enum values added in 0008).
--
-- Access rules (Matt, July 2026):
--   basic — paid Basic access (all_members content)
--   gift  — free Basic-level access for 1 month
--   vip   — free Basic-level access for 3 months
--   pro   — everything, including pro_only content; vip_plus content too
--   sponsors' linked members hold an ongoing pro membership (source=sponsor)

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
      (current_user_tiers() && array['tsls_vip','sub_annual','speaker','admin','pro']::access_tier[])
    when required = 'pro_only' then
      (current_user_tiers() && array['pro','admin']::access_tier[])
    else false
  end;
$$;

-- Key/value settings written only by server actions via the service role
-- (Stripe keys, price ids, webhook secret). RLS on, zero policies: invisible
-- to every client-side role.
create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;

-- Stripe linkage
alter table profiles
  add column if not exists stripe_customer_id text;
alter table memberships
  add column if not exists stripe_subscription_id text;
create index if not exists memberships_stripe_sub_idx
  on memberships (stripe_subscription_id);

-- Sponsor seats: members attached to a sponsor hold Pro while the link
-- exists. Seat counts per sponsorship tier are not enforced yet (rules TBD).
create table if not exists sponsor_members (
  sponsor_id uuid not null references sponsors(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sponsor_id, profile_id)
);
alter table sponsor_members enable row level security;

create policy "sponsor_members: admin read"
  on sponsor_members for select
  using (is_admin());
