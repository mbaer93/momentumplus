-- ============================================================================
-- Momentum+ migration 0054: membership tiers become DATA, not a Postgres enum.
--
-- Why: Matt needs to stand up new member types (Momentum+ Lite now, a
-- networking-only tier later) and set what each one reaches, from the Control
-- Center, without a migration and a deploy (Matt, 2026-07-28). An enum can't
-- do that — every new value needs `alter type` in its own SQL run, plus edits
-- to the six TypeScript lists that mirror it.
--
-- Three new tables:
--   member_tiers   — one row per tier. Carries what the tier IS (label,
--                    rank) and the two content gates it clears, so `can_view`
--                    reads the registry instead of hardcoded arrays.
--   app_features   — one row per reachable area of the product.
--   tier_features  — the grid: may THIS tier reach THAT feature.
--
-- `memberships.tier` converts from the `access_tier` enum to text. The enum
-- type is deliberately left in place (unused) rather than dropped: rolling
-- this back should not mean recreating a type other objects may reference.
--
-- ORDERING NOTE: can_view() is rewritten BEFORE current_user_tiers() is
-- dropped, and it deliberately does not call it. Dropping a function that
-- RLS policies reach through would take the policies with it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The tier registry
-- ---------------------------------------------------------------------------
create table if not exists member_tiers (
  slug text primary key,
  label text not null,
  description text not null default '',
  -- Lower rank = more privileged. Mirrors TIER_PRECEDENCE in lib/membership.ts,
  -- spaced by 10 so a new tier can be slotted between two existing ones.
  rank integer not null default 500,
  -- Built-ins can be edited but never deleted; the app references them by slug.
  is_builtin boolean not null default false,
  -- Is this tier offered to the public yet? False = it exists, admins can
  -- assign it, but it appears in no pricing grid and no checkout. This is
  -- what the Control Center's Go Live button flips.
  is_public boolean not null default false,
  went_live_at timestamptz,
  -- The two legacy content gates (SPEC.md §2), now per-tier data.
  clears_vip_plus boolean not null default false,
  clears_pro_only boolean not null default false,
  -- How much of the Library this tier sees. 'current_season' is the default
  -- for paying members; 'all_seasons' is the Pro differentiator.
  library_scope text not null default 'current_season'
    check (library_scope in ('none', 'current_season', 'all_seasons')),
  -- Does a member on this tier count as a monthly user in the speaker-of-the-
  -- month report, and toward what a speaker is paid? A cut-price tier can be
  -- worth having without being worth a full share (Matt, 2026-07-28).
  counts_toward_speaker_pay boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

-- Seed every tier the enum already carried, plus Momentum+ Lite.
-- clears_vip_plus / clears_pro_only reproduce the arrays that were hardcoded
-- in can_view() as of migration 0038 — this seed must not change who can see
-- what on the day it runs.
insert into member_tiers
  (slug, label, description, rank, is_builtin, is_public,
   clears_vip_plus, clears_pro_only, library_scope)
values
  ('admin',         'Administrator',    'Internal. Reaches everything.',            10,  true, false, true,  true,  'all_seasons'),
  ('pro',           'Momentum+ Pro',    'Full library including past seasons.',     20,  true, false, true,  true,  'all_seasons'),
  ('sponsor',       'Sponsor',          'The rep who runs a sponsor page.',         30,  true, false, true,  true,  'all_seasons'),
  ('speaker',       'Speaker',          'Granted with a speaking slot.',            40,  true, false, true,  false, 'all_seasons'),
  ('sub_annual',    'Annual Member',    'Legacy — folded into Pro in 0040.',        50,  true, false, true,  false, 'all_seasons'),
  ('tsls_vip',      'VIP Member',       'Legacy — folded into Pro in 0040.',        60,  true, false, true,  false, 'all_seasons'),
  ('sub_6mo',       '6-Month Member',   'Legacy — folded into Member in 0040.',     70,  true, false, false, false, 'current_season'),
  ('sub_3mo',       '3-Month Member',   'Legacy — folded into Member in 0040.',     80,  true, false, false, false, 'current_season'),
  ('sub_monthly',   'Monthly Member',   'Legacy — folded into Member in 0040.',     90,  true, false, false, false, 'current_season'),
  ('basic',         'Momentum+ Member', 'The tier on sale today. Current season.', 100,  true, true,  false, false, 'current_season'),
  ('lite',          'Momentum+ Lite',   'Rooted Focus and Grow on the Go only.',   105,  true, false, false, false, 'none'),
  ('vip',           'VIP Access',       'Three comped months at Member level.',    110,  true, false, false, false, 'current_season'),
  ('gift',          'Gift Member',      'Gifted membership.',                      120,  true, false, false, false, 'current_season'),
  ('tsls_attendee', 'Summit Attendee',  'Legacy — folded into Member in 0040.',    130,  true, false, false, false, 'current_season')
on conflict (slug) do nothing;

-- Tiers that are comped or internal were already excluded from revenue
-- (lib/revenue.ts EXCLUDED_TIERS); Lite joins them because it is not a full
-- share of a month. Everything else keeps counting.
update member_tiers set counts_toward_speaker_pay = false
  where slug in ('admin', 'speaker', 'sponsor', 'lite');

-- Momentum+ Member is already on sale, so it did not "go live" today.
update member_tiers set went_live_at = created_at
  where slug = 'basic' and is_public and went_live_at is null;

-- ---------------------------------------------------------------------------
-- 2. The feature registry
-- ---------------------------------------------------------------------------
create table if not exists app_features (
  key text primary key,
  label text not null,
  description text not null default '',
  -- The route this feature gates. Null for features that are not a nav tab.
  nav_href text,
  sort integer not null default 100,
  -- Global kill switch, independent of tiers: false = nobody but admins sees
  -- it at all, however the grid is set. This is the per-feature Go Live.
  is_launched boolean not null default true,
  created_at timestamptz not null default now()
);

-- Dashboard and My Profile are deliberately absent: they are how a member
-- reads their own plan and pays for it. Nothing should be able to switch
-- those off, so they are not offered as switches.
insert into app_features (key, label, description, nav_href, sort, is_launched)
values
  ('sessions',      'Sessions',            'Live and upcoming sessions, and enrolling.',   '/sessions',      20,  true),
  ('rooted_focus',  'Rooted Focus',        'Recurring drop-in focus sessions.',            '/rooted-focus',  30,  true),
  ('calendar',      'Calendar',            'Month view of everything enrolled.',           '/calendar',      40,  true),
  ('library',       'Library',             'Recorded sessions with AI takeaways.',         '/library',       50,  true),
  ('education',     'Grow on the Go',      'Courses, lessons and CE certificates.',        '/education',     60,  true),
  ('aspire2achieve','Aspire2Achieve Growth','Monthly drop-in accountability sessions.',    '/aspire2achieve',70,  false),
  ('community',     'Community',           'Member chat channels.',                        '/community',     80,  true),
  ('members',       'Members',             'The member directory.',                        '/members',       90,  true),
  ('speakers',      'Speakers',            'Speaker profiles.',                            '/speakers',      100, true),
  ('networking',    'Networking',          'Networking groups.',                           '/networking',    110, false),
  ('sponsors',      'Sponsors',            'Sponsor profiles and offers.',                 '/sponsors',      120, true),
  ('resources',     'Resources',           'Partner and member resources.',                '/resources',     130, true),
  ('services',      'Additional Services', 'SLC services and signup links.',               '/services',      140, true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The grid
-- ---------------------------------------------------------------------------
create table if not exists tier_features (
  tier_slug text not null references member_tiers (slug) on delete cascade on update cascade,
  feature_key text not null references app_features (key) on delete cascade on update cascade,
  allowed boolean not null default false,
  primary key (tier_slug, feature_key)
);

create index if not exists tier_features_feature_idx on tier_features (feature_key);

-- Default: every tier reaches everything. Momentum+ Member is the only tier
-- on sale and it gets the whole product this season (Matt, 2026-07-28); the
-- legacy tiers behaved that way already, so this preserves today's access.
insert into tier_features (tier_slug, feature_key, allowed)
select t.slug, f.key, true
from member_tiers t cross join app_features f
on conflict (tier_slug, feature_key) do nothing;

-- Momentum+ Lite is the exception: Rooted Focus and Grow on the Go only,
-- plus the two screens it takes to be a signed-in human.
update tier_features
   set allowed = false
 where tier_slug = 'lite'
   and feature_key not in ('rooted_focus', 'education');

-- ---------------------------------------------------------------------------
-- 4. can_view() reads the registry
--
-- Rewritten BEFORE current_user_tiers() is dropped, and no longer calls it.
-- `m.tier::text` works whether the column is still the enum (it is, at this
-- point in the migration) or already text.
-- ---------------------------------------------------------------------------
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
      exists (
        select 1
        from memberships m
        join member_tiers t on t.slug = m.tier::text
        where m.profile_id = auth.uid()
          and membership_grants_access(m.status, m.access_expires_at)
          and t.clears_vip_plus
      )
    when required = 'pro_only' then
      exists (
        select 1
        from memberships m
        join member_tiers t on t.slug = m.tier::text
        where m.profile_id = auth.uid()
          and membership_grants_access(m.status, m.access_expires_at)
          and t.clears_pro_only
      )
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Drop the enum dependency, convert the columns
-- ---------------------------------------------------------------------------
drop function if exists current_user_tiers();

alter table memberships alter column tier type text using tier::text;
alter table import_log  alter column tier type text using tier::text;

-- Recreated over text. Nothing in RLS calls this any more (can_view stopped
-- using it above), but server code and future policies still want it.
create or replace function current_user_tiers()
returns text[]
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

-- Deliberately NO foreign key from memberships.tier to member_tiers.slug:
-- the Stripe and GHL webhooks write this column, and a payment must not be
-- lost because a product mapped to a slug nobody created yet. The app
-- validates on the way in; unknown slugs degrade to "no extra entitlements"
-- rather than an exception.

-- ---------------------------------------------------------------------------
-- 6. Is this feature reachable by the signed-in member?
--
-- Admins bypass everything (they preview unlaunched areas). Otherwise the
-- feature must be launched AND the member's tier must be granted it.
-- ---------------------------------------------------------------------------
create or replace function has_feature(feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when is_admin() then true
    when not exists (select 1 from app_features f where f.key = feature and f.is_launched)
      then false
    else exists (
      select 1
      from memberships m
      join tier_features tf
        on tf.tier_slug = m.tier::text
       and tf.feature_key = feature
      where m.profile_id = auth.uid()
        and membership_grants_access(m.status, m.access_expires_at)
        and tf.allowed
    )
  end;
$$;

-- ---------------------------------------------------------------------------
-- 7. RLS
--
-- The three registry tables are readable by any signed-in member: the sidebar
-- has to know a feature exists in order to draw a padlock on it, and the
-- upgrade page has to name the tier that would unlock it. None of it is
-- secret. Writes are admin-only (and in practice go through the service role
-- from the Control Center).
-- ---------------------------------------------------------------------------
alter table member_tiers enable row level security;
alter table app_features enable row level security;
alter table tier_features enable row level security;

drop policy if exists "member_tiers: read" on member_tiers;
create policy "member_tiers: read" on member_tiers
  for select using (auth.uid() is not null);

drop policy if exists "member_tiers: admin write" on member_tiers;
create policy "member_tiers: admin write" on member_tiers
  for all using (is_admin()) with check (is_admin());

drop policy if exists "app_features: read" on app_features;
create policy "app_features: read" on app_features
  for select using (auth.uid() is not null);

drop policy if exists "app_features: admin write" on app_features;
create policy "app_features: admin write" on app_features
  for all using (is_admin()) with check (is_admin());

drop policy if exists "tier_features: read" on tier_features;
create policy "tier_features: read" on tier_features
  for select using (auth.uid() is not null);

drop policy if exists "tier_features: admin write" on tier_features;
create policy "tier_features: admin write" on tier_features
  for all using (is_admin()) with check (is_admin());

-- The public pricing grid is rendered for signed-out visitors, so anon needs
-- to read which tiers are live. Only the public ones.
drop policy if exists "member_tiers: public read live" on member_tiers;
create policy "member_tiers: public read live" on member_tiers
  for select using (is_public and archived_at is null);
