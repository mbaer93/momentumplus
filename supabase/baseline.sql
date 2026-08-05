-- GENERATED FILE — do not edit. Rebuild with: node scripts/make-baseline.mjs
-- Full schema baseline: every migration in order (0001_init.sql … 0077_podcast_engagement.sql).
-- Run ONCE against a FRESH Supabase project to mirror production's schema.
-- Never run this against the production database.


-- ============================================================
-- 0001_init.sql
-- ============================================================
-- ============================================================================
-- Momentum+ initial schema (Phase 1)
-- Mirrors SPEC.md §3 (data model) and §2 (access tiers / gating levels).
--
-- Security model (CLAUDE.md non-negotiables #1, #2):
--   * Access control lives in the database. Every table has RLS enabled.
--   * Members read published content at/below their access level and write only
--     their own notes, enrollments, prefs, and profile.
--   * Admins bypass via the is_admin() helper.
--   * The service-role key (server routes only) bypasses RLS entirely.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type access_tier as enum (
  'tsls_attendee',
  'tsls_vip',
  'sub_3mo',
  'sub_6mo',
  'sub_monthly',
  'sub_annual',
  'speaker',
  'admin'
);

create type membership_status as enum ('active', 'past_due', 'canceled', 'expired');

create type membership_source as enum ('ghl', 'tsls_import', 'admin');

-- Content gating levels (SPEC.md §2).
create type access_level as enum ('all_members', 'vip_plus', 'admin_only');

create type session_status as enum (
  'draft',
  'scheduled',
  'live',
  'completed',
  'archived'
);

create type attended_source as enum ('zoom', 'manual');

create type sponsor_tier as enum ('title', 'partner', 'community');

create type sponsor_event_kind as enum ('impression', 'click');

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null,
  phone text,
  avatar_url text,
  bio text,
  industry text,
  company text,
  title text,
  links jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- memberships — GHL is the source of truth for payment status (SPEC.md §4)
-- ---------------------------------------------------------------------------
create table memberships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  tier access_tier not null,
  status membership_status not null default 'active',
  access_starts_at timestamptz,
  access_expires_at timestamptz,
  ghl_contact_id text,
  source membership_source not null default 'ghl',
  created_at timestamptz not null default now()
);

create index memberships_profile_id_idx on memberships (profile_id);
create index memberships_ghl_contact_id_idx on memberships (ghl_contact_id);

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so RLS policies can call them safely)
-- ---------------------------------------------------------------------------

-- True if the current user holds an active admin-tier membership.
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from memberships m
    where m.profile_id = auth.uid()
      and m.tier = 'admin'
      and m.status = 'active'
  );
$$;

-- The set of access tiers the current user currently holds (active + unexpired).
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
    and m.status = 'active'
    and (m.access_expires_at is null or m.access_expires_at > now());
$$;

-- True if the current user can view content gated at `required`.
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
          and m.status = 'active'
          and (m.access_expires_at is null or m.access_expires_at > now())
      )
    when required = 'vip_plus' then
      (current_user_tiers() && array['tsls_vip','sub_annual','speaker','admin']::access_tier[])
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- speakers
-- ---------------------------------------------------------------------------
create table speakers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles (id) on delete set null,
  name text not null,
  title text,
  bio text,
  headshot_url text,
  industries text[] not null default '{}',
  links jsonb not null default '{}'::jsonb,
  featured boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
create table sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  speaker_id uuid references speakers (id) on delete set null,
  category text,
  starts_at timestamptz,
  duration_min integer,
  zoom_meeting_id text,
  zoom_join_url text,
  capacity integer,
  min_access access_level not null default 'all_members',
  status session_status not null default 'draft',
  created_at timestamptz not null default now()
);

create index sessions_starts_at_idx on sessions (starts_at);
create index sessions_status_idx on sessions (status);

-- ---------------------------------------------------------------------------
-- enrollments
-- ---------------------------------------------------------------------------
create table enrollments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  attended boolean not null default false,
  attended_source attended_source,
  unique (session_id, profile_id)
);

create index enrollments_profile_id_idx on enrollments (profile_id);

-- ---------------------------------------------------------------------------
-- session_notes — private per member (RLS: owner only)
-- ---------------------------------------------------------------------------
create table session_notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  body text not null default '',
  updated_at timestamptz not null default now(),
  unique (session_id, profile_id)
);

-- ---------------------------------------------------------------------------
-- ai_summaries
-- ---------------------------------------------------------------------------
create table ai_summaries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references sessions (id) on delete cascade,
  takeaways jsonb not null default '[]'::jsonb,
  quotes jsonb not null default '[]'::jsonb,
  action_items jsonb not null default '[]'::jsonb,
  highlights text,
  model text,
  generated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- videos
-- ---------------------------------------------------------------------------
create table videos (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions (id) on delete set null,
  title text not null,
  category text,
  mux_asset_id text,
  mux_playback_id text,
  duration_sec integer,
  min_access access_level not null default 'all_members',
  published_at timestamptz
);

create index videos_published_at_idx on videos (published_at);

-- ---------------------------------------------------------------------------
-- video_views
-- ---------------------------------------------------------------------------
create table video_views (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  watched_at timestamptz not null default now(),
  seconds_watched integer not null default 0
);

create index video_views_profile_id_idx on video_views (profile_id);

-- ---------------------------------------------------------------------------
-- resources
-- ---------------------------------------------------------------------------
create table resources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text,
  description text,
  url text,
  file_path text,
  partner_name text,
  min_access access_level not null default 'all_members',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- resource_uses
-- ---------------------------------------------------------------------------
create table resource_uses (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references resources (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  used_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- sponsors
-- ---------------------------------------------------------------------------
create table sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tier sponsor_tier not null default 'partner',
  tagline text,
  offer text,
  website text,
  logo_url text,
  rail_active boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- sponsor_events — impression/click tracking
-- ---------------------------------------------------------------------------
create table sponsor_events (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null references sponsors (id) on delete cascade,
  profile_id uuid references profiles (id) on delete set null,
  kind sponsor_event_kind not null,
  at timestamptz not null default now()
);

create index sponsor_events_sponsor_id_idx on sponsor_events (sponsor_id);

-- ---------------------------------------------------------------------------
-- announcements
-- ---------------------------------------------------------------------------
create table announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  audience_tiers text[] not null default '{}',
  channels text[] not null default '{}',
  sent_at timestamptz,
  sent_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- notification_prefs
-- keys: session_new, session_reminder, recording_ready, chat_reply,
--       chat_channel, chat_dm, platform (email locked on), resource_new,
--       event_reminder
-- ---------------------------------------------------------------------------
create table notification_prefs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  key text not null,
  email boolean not null default true,
  sms boolean not null default false,
  in_app boolean not null default true,
  unique (profile_id, key)
);

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table profiles           enable row level security;
alter table memberships        enable row level security;
alter table speakers           enable row level security;
alter table sessions           enable row level security;
alter table enrollments        enable row level security;
alter table session_notes      enable row level security;
alter table ai_summaries       enable row level security;
alter table videos             enable row level security;
alter table video_views        enable row level security;
alter table resources          enable row level security;
alter table resource_uses      enable row level security;
alter table sponsors           enable row level security;
alter table sponsor_events     enable row level security;
alter table announcements      enable row level security;
alter table notification_prefs enable row level security;

-- --- profiles ---------------------------------------------------------------
create policy "profiles: read own or admin"
  on profiles for select
  using (id = auth.uid() or is_admin());

create policy "profiles: insert self"
  on profiles for insert
  with check (id = auth.uid());

create policy "profiles: update own or admin"
  on profiles for update
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

-- --- memberships (read own / admin; writes are server-role only) ------------
create policy "memberships: read own or admin"
  on memberships for select
  using (profile_id = auth.uid() or is_admin());

create policy "memberships: admin write"
  on memberships for all
  using (is_admin())
  with check (is_admin());

-- --- speakers (public to members; admin writes) -----------------------------
create policy "speakers: read for members"
  on speakers for select
  using (
    is_admin()
    or exists (
      select 1 from memberships m
      where m.profile_id = auth.uid()
        and m.status = 'active'
        and (m.access_expires_at is null or m.access_expires_at > now())
    )
  );

create policy "speakers: admin write"
  on speakers for all
  using (is_admin())
  with check (is_admin());

-- --- sessions (members see published at/below their access level) -----------
create policy "sessions: read visible"
  on sessions for select
  using (
    is_admin()
    or (
      status in ('scheduled', 'live', 'completed', 'archived')
      and can_view(min_access)
    )
  );

create policy "sessions: admin write"
  on sessions for all
  using (is_admin())
  with check (is_admin());

-- --- enrollments (owner rows; admin sees all) -------------------------------
create policy "enrollments: read own or admin"
  on enrollments for select
  using (profile_id = auth.uid() or is_admin());

create policy "enrollments: enroll self into visible session"
  on enrollments for insert
  with check (
    profile_id = auth.uid()
    and exists (
      select 1 from sessions s
      where s.id = session_id
        and s.status in ('scheduled', 'live')
        and can_view(s.min_access)
    )
  );

create policy "enrollments: update own or admin"
  on enrollments for update
  using (profile_id = auth.uid() or is_admin())
  with check (profile_id = auth.uid() or is_admin());

create policy "enrollments: delete own or admin"
  on enrollments for delete
  using (profile_id = auth.uid() or is_admin());

-- --- session_notes (owner only) ---------------------------------------------
create policy "session_notes: owner all"
  on session_notes for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- --- ai_summaries (visible when the parent session is visible) --------------
create policy "ai_summaries: read when session visible"
  on ai_summaries for select
  using (
    is_admin()
    or exists (
      select 1 from sessions s
      where s.id = session_id
        and s.status in ('completed', 'archived')
        and can_view(s.min_access)
    )
  );

create policy "ai_summaries: admin write"
  on ai_summaries for all
  using (is_admin())
  with check (is_admin());

-- --- videos (published at/below access level) -------------------------------
create policy "videos: read published visible"
  on videos for select
  using (
    is_admin()
    or (published_at is not null and can_view(min_access))
  );

create policy "videos: admin write"
  on videos for all
  using (is_admin())
  with check (is_admin());

-- --- video_views (owner writes; admin reads) --------------------------------
create policy "video_views: read own or admin"
  on video_views for select
  using (profile_id = auth.uid() or is_admin());

create policy "video_views: insert self"
  on video_views for insert
  with check (profile_id = auth.uid());

create policy "video_views: update own"
  on video_views for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- --- resources (active, visible at/below access level) ----------------------
create policy "resources: read active visible"
  on resources for select
  using (
    is_admin()
    or (active and can_view(min_access))
  );

create policy "resources: admin write"
  on resources for all
  using (is_admin())
  with check (is_admin());

-- --- resource_uses (owner writes; admin reads) ------------------------------
create policy "resource_uses: read own or admin"
  on resource_uses for select
  using (profile_id = auth.uid() or is_admin());

create policy "resource_uses: insert self"
  on resource_uses for insert
  with check (profile_id = auth.uid());

-- --- sponsors (all members read; admin writes) -----------------------------
create policy "sponsors: read for members"
  on sponsors for select
  using (
    is_admin()
    or exists (
      select 1 from memberships m
      where m.profile_id = auth.uid()
        and m.status = 'active'
        and (m.access_expires_at is null or m.access_expires_at > now())
    )
  );

create policy "sponsors: admin write"
  on sponsors for all
  using (is_admin())
  with check (is_admin());

-- --- sponsor_events (members log own; admin reads) --------------------------
create policy "sponsor_events: read admin"
  on sponsor_events for select
  using (is_admin());

create policy "sponsor_events: insert self or anon-null"
  on sponsor_events for insert
  with check (profile_id is null or profile_id = auth.uid());

-- --- announcements (members read sent; admin writes) ------------------------
create policy "announcements: read sent or admin"
  on announcements for select
  using (is_admin() or sent_at is not null);

create policy "announcements: admin write"
  on announcements for all
  using (is_admin())
  with check (is_admin());

-- --- notification_prefs (owner only; admin read) ----------------------------
create policy "notification_prefs: read own or admin"
  on notification_prefs for select
  using (profile_id = auth.uid() or is_admin());

create policy "notification_prefs: owner write"
  on notification_prefs for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ============================================================================
-- New-user trigger: create a profile row when an auth user signs up.
-- ============================================================================
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- 0002_membership_grace.sql
-- ============================================================
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

-- ============================================================
-- 0003_notifications.sql
-- ============================================================
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

-- ============================================================
-- 0004_sponsor_sidebar_ad.sql
-- ============================================================
-- Sponsors can carry two graphics: a logo (profile/cards) and a sidebar ad
-- creative shown in the left panel "Presented by" slot.
alter table public.sponsors
  add column if not exists sidebar_ad_url text;

-- ============================================================
-- 0005_admin_title.sql
-- ============================================================
-- Admins can set a title (in relation to Momentum+/TSLS) that is shown next
-- to the Admin badge on their community chat messages.
alter table public.profiles
  add column if not exists admin_title text;

-- ============================================================
-- 0006_education.sql
-- ============================================================
-- Education: curated courses (learning tracks) built from library videos,
-- with per-member lesson completion. Mirrors the videos/resources RLS model:
-- members read published content at/below their access level; writes are
-- admin-only; progress rows belong to the member.

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text,
  min_access access_level not null default 'all_members',
  position int not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists course_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  video_id uuid references videos(id) on delete set null,
  title text not null,
  summary text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists course_lessons_course_idx
  on course_lessons (course_id, position);

create table if not exists lesson_progress (
  profile_id uuid not null references profiles(id) on delete cascade,
  lesson_id uuid not null references course_lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (profile_id, lesson_id)
);

alter table courses enable row level security;
alter table course_lessons enable row level security;
alter table lesson_progress enable row level security;

create policy "courses: read published visible"
  on courses for select
  using (
    is_admin()
    or (published_at is not null and can_view(min_access))
  );

create policy "courses: admin write"
  on courses for all
  using (is_admin())
  with check (is_admin());

create policy "course_lessons: read via course"
  on course_lessons for select
  using (
    exists (
      select 1 from courses c
      where c.id = course_id
        and (
          is_admin()
          or (c.published_at is not null and can_view(c.min_access))
        )
    )
  );

create policy "course_lessons: admin write"
  on course_lessons for all
  using (is_admin())
  with check (is_admin());

create policy "lesson_progress: read own or admin"
  on lesson_progress for select
  using (profile_id = auth.uid() or is_admin());

create policy "lesson_progress: insert own"
  on lesson_progress for insert
  with check (profile_id = auth.uid());

create policy "lesson_progress: delete own"
  on lesson_progress for delete
  using (profile_id = auth.uid());

-- ============================================================
-- 0007_admin_roles.sql
-- ============================================================
-- Admin roles: one Super Admin tier above standard admins. Standard admins
-- get per-area permissions (sessions, members, announcements, sponsors,
-- content) adjustable by a super admin. Enforcement happens server-side in
-- requireAdmin(area); these columns are data, and a trigger stops non-service
-- clients from touching them (a standard admin must not self-promote via the
-- own-row profile UPDATE policy).

alter table public.profiles
  add column if not exists admin_role text
    check (admin_role in ('super', 'standard')),
  add column if not exists admin_perms jsonb not null default '{}'::jsonb;

create or replace function public.protect_admin_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is null for the service-role client (admin server actions);
  -- any authenticated user editing their own row keeps the old values.
  if auth.uid() is not null then
    new.admin_role := old.admin_role;
    new.admin_perms := old.admin_perms;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_admin_columns on public.profiles;
create trigger protect_admin_columns
  before update on public.profiles
  for each row
  execute function public.protect_admin_columns();

revoke execute on function public.protect_admin_columns() from anon, authenticated;

-- Bootstrap: the founding account is the Super Admin.
update public.profiles
   set admin_role = 'super'
 where lower(email) = 'matt@socialdrivemedia.com';

-- ============================================================
-- 0008_member_levels_enums.sql
-- ============================================================
-- New member levels (Basic / Gift / VIP / Pro), the pro-only content gate,
-- and membership sources for the Zapier/Stripe/sponsor pipelines.
-- Enum additions live alone in this migration: Postgres won't let a new enum
-- value be referenced in the same transaction that adds it, so the functions
-- and tables that use these land in 0009.

alter type access_tier add value if not exists 'basic';
alter type access_tier add value if not exists 'gift';
alter type access_tier add value if not exists 'vip';
alter type access_tier add value if not exists 'pro';

alter type access_level add value if not exists 'pro_only';

alter type membership_source add value if not exists 'zapier';
alter type membership_source add value if not exists 'stripe';
alter type membership_source add value if not exists 'sponsor';

-- ============================================================
-- 0009_stripe_billing.sql
-- ============================================================
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

-- ============================================================
-- 0010_video_notes.sql
-- ============================================================
-- Private per-member notes on Library videos (mirrors session_notes).
-- Strictly owner-only: no admin read — notes are visible to their author
-- and no one else.
create table if not exists video_notes (
  profile_id uuid not null references profiles(id) on delete cascade,
  video_id uuid not null references videos(id) on delete cascade,
  body text not null default '',
  updated_at timestamptz not null default now(),
  primary key (profile_id, video_id)
);

alter table video_notes enable row level security;

create policy "video_notes: owner all"
  on video_notes for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ============================================================
-- 0011_video_ai_summaries.sql
-- ============================================================
-- AI summaries for standalone Library uploads (not just session recordings).
-- The upload pipeline stores the Mux asset id; the summaries cron requests
-- Mux auto-captions, pulls the transcript, and writes a summary keyed to the
-- video. ai_summaries rows now attach to a session OR a video.

alter table videos
  add column if not exists mux_asset_id text;

alter table ai_summaries
  add column if not exists video_id uuid unique references videos(id) on delete cascade;

alter table ai_summaries
  alter column session_id drop not null;

create policy "ai_summaries: read via video"
  on ai_summaries for select
  using (
    video_id is not null and exists (
      select 1 from videos v
      where v.id = video_id
        and v.published_at is not null
        and can_view(v.min_access)
    )
  );

-- ============================================================
-- 0012_resource_images.sql
-- ============================================================
-- Resource cards carry an image: uploaded by an admin or pulled from the
-- resource link's Open Graph preview. Stored in the public resource-images
-- bucket; this column holds the display URL.
alter table resources
  add column if not exists image_url text;

-- ============================================================
-- 0013_speaker_media.sql
-- ============================================================
-- Speakers: uploaded headshot (speaker-headshots bucket) + website link.
alter table speakers
  add column if not exists headshot_url text,
  add column if not exists website text;

-- ============================================================
-- 0014_education_rich.sql
-- ============================================================
-- Education 2.0:
--   courses.ce_hours — admin-set continuing-education hours, printed on the
--     completion certificate
--   lessons carry rich content: reading text, an image, attached documents
--     ([{name,url}] in the education-media bucket), and an optional quiz
--     ({questions:[{q, options[], answer}]}) — answers never leave the server
-- Completion rules live in code: quiz lessons complete by passing; no-quiz
-- lessons complete automatically when opened. All lessons complete → the
-- member can print their certificate.

alter table courses
  add column if not exists ce_hours numeric(5,1);

alter table course_lessons
  add column if not exists content text,
  add column if not exists image_url text,
  add column if not exists documents jsonb not null default '[]'::jsonb,
  add column if not exists quiz jsonb;

-- ============================================================
-- 0015_video_thumbnails.sql
-- ============================================================
-- Library video thumbnails: optional uploaded image that overrides the
-- default Mux screen grab shown on recording cards.
alter table public.videos
  add column if not exists thumbnail_url text;

-- ============================================================
-- 0016_ce_hours_two_decimals.sql
-- ============================================================
-- CE hours accept whole numbers or decimals (e.g. 1.25) — two decimal places.
alter table courses
  alter column ce_hours type numeric(6,2);

-- ============================================================
-- 0017_scheduled_posts.sql
-- ============================================================
-- Scheduled community posts: admins compose announcements ahead of time;
-- the cron posts them to the chosen chat channel at send_at as
-- "Momentum+ Team". Admin-only rows; the cron uses the service role.
create table if not exists scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'announcements',
  body text not null,
  send_at timestamptz not null,
  sent_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table scheduled_posts enable row level security;

create policy "scheduled_posts: admin all" on scheduled_posts
  for all using (is_admin()) with check (is_admin());

create index if not exists scheduled_posts_due_idx
  on scheduled_posts (send_at) where sent_at is null;

-- ============================================================
-- 0018_stripe_sub_unique.sql
-- ============================================================
-- One membership row per Stripe subscription, enforced in the database.
-- The webhook's check-then-insert idempotency can race when Stripe delivers
-- checkout.session.completed and customer.subscription.updated concurrently
-- (or retries overlap); this index is the backstop.

-- Clean up any duplicates the race already created: keep the row with the
-- most access (latest expiry; ties broken by oldest row).
with ranked as (
  select id,
         row_number() over (
           partition by stripe_subscription_id
           order by access_expires_at desc nulls first, created_at asc
         ) as rn
  from public.memberships
  where stripe_subscription_id is not null
)
delete from public.memberships m
using ranked r
where m.id = r.id
  and r.rn > 1;

drop index if exists memberships_stripe_sub_idx;

create unique index if not exists memberships_stripe_subscription_id_key
  on public.memberships (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- ============================================================
-- 0019_zoom_passcode.sql
-- ============================================================
-- Zoom meetings get a passcode by default on most accounts. The embedded
-- SDK join needs it explicitly (the external join URL embeds it, the SDK
-- does not), so store it at publish time. Not member-readable: column is
-- stripped from member queries; only the live-room page (server) reads it
-- for enrolled members inside the join window.
alter table public.sessions
  add column if not exists zoom_passcode text;

-- ============================================================
-- 0020_security_hardening.sql
-- ============================================================
-- Security hardening (audit batch B).
--
-- 1. Quiz answers must not be readable by members at the DB boundary.
--    The app strips them (publicQuiz), but the `quiz` jsonb (with answer
--    indexes) was selectable via PostgREST with any member JWT. Column-level
--    grants: members can read every lesson column EXCEPT quiz; the server
--    reads quiz via the service role.
revoke select on table public.course_lessons from anon, authenticated;
grant select (id, course_id, video_id, title, summary, position, created_at,
              content, image_url, documents)
  on public.course_lessons to anon, authenticated;

-- 2. Lesson completion rows could be inserted directly for ANY lesson —
--    including quiz lessons (skipping the test) and lessons of unpublished
--    or tier-gated courses — minting fraudulent CE certificates. The insert
--    policy now allows only test-free lessons of published, visible courses;
--    quiz lessons complete exclusively through the server-graded action
--    (service role). SECURITY DEFINER so the check itself can read the
--    now-hidden quiz column.
create or replace function public.lesson_completable_by_member(lesson uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from course_lessons cl
    join courses c on c.id = cl.course_id
    where cl.id = lesson
      and (cl.quiz is null
           or jsonb_array_length(coalesce(cl.quiz->'questions', '[]'::jsonb)) = 0)
      and c.published_at is not null
      and can_view(c.min_access)
  );
$$;

drop policy if exists "lesson_progress: insert own" on public.lesson_progress;
create policy "lesson_progress: insert own completable" on public.lesson_progress
  for insert with check (
    profile_id = auth.uid()
    and lesson_completable_by_member(lesson_id)
  );

-- 3. Zoom join link (and passcode) are for enrolled members only. The row
--    was member-readable whole, so the "enrolled-only" join link was
--    cosmetic. Members can read the schedule columns; join credentials are
--    handed out server-side after the enrollment check.
revoke select on table public.sessions from anon, authenticated;
grant select (id, title, description, speaker_id, category, starts_at,
              duration_min, capacity, min_access, status, created_at)
  on public.sessions to anon, authenticated;

-- 4. Sponsor impression/click stats could be inserted by ANYONE holding the
--    public anon key (profile_id null satisfied the check). Authenticated
--    members only.
drop policy if exists "sponsor_events: insert self or anon-null" on public.sponsor_events;
create policy "sponsor_events: insert authenticated" on public.sponsor_events
  for insert to authenticated
  with check (profile_id is null or profile_id = auth.uid());

-- 5. Lesson documents/images for gated courses lived in a PUBLIC bucket —
--    permanent unauthenticated URLs. Private from now on; the app serves
--    short-lived signed URLs after the RLS-gated course fetch.
update storage.buckets set public = false where id = 'education-media';

-- ============================================================
-- 0021_capacity_and_views.sql
-- ============================================================
-- Batch C data integrity.

-- 1. Session capacity was collected in the admin form but enforced nowhere —
--    a 20-seat mastermind accepted unlimited enrollments. DB trigger is the
--    backstop (the enroll action also checks first for a friendly message).
create or replace function public.enforce_session_capacity()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  cap integer;
  taken integer;
begin
  select capacity into cap from sessions where id = new.session_id;
  if cap is not null and cap > 0 then
    select count(*) into taken from enrollments where session_id = new.session_id;
    if taken >= cap then
      raise exception 'Session is full';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enrollments_capacity on public.enrollments;
create trigger enrollments_capacity
  before insert on public.enrollments
  for each row execute function public.enforce_session_capacity();

-- 2. Repeat visits inflated the learning record: one view row per page
--    exit with no uniqueness. Dedupe (keep the earliest view) and constrain.
with ranked as (
  select id, row_number() over (
    partition by profile_id, video_id order by watched_at asc
  ) as rn
  from public.video_views
)
delete from public.video_views v using ranked r
where v.id = r.id and r.rn > 1;

create unique index if not exists video_views_profile_video_key
  on public.video_views (profile_id, video_id);

-- ============================================================
-- 0022_pii_hardening.sql
-- ============================================================
-- PII hardening (security audit).
--
-- 1. Members could PATCH any column on their own profile row — the update
--    policy checks row ownership, not which columns change. The 0007 trigger
--    only pins admin_role/admin_perms. The sharp one: overwriting
--    stripe_customer_id then opening the billing portal reaches ANOTHER
--    member's invoices/payment method. Column-level grants restrict members
--    to the profile fields they legitimately edit; email, stripe_customer_id,
--    admin_role, admin_perms, admin_title are server/service-role only.
revoke update on table public.profiles from anon, authenticated;
grant update (full_name, phone, avatar_url, bio, industry, company, title)
  on public.profiles to authenticated;

-- 2. Members could PATCH attended/attended_source on their own enrollment
--    and fake attendance (spec: attendance comes from Zoom join data). They
--    only need insert (enroll) and delete (unenroll); revoke UPDATE.
revoke update on table public.enrollments from anon, authenticated;

-- 3. announcements SELECT had no TO clause → the anon key alone could read
--    every sent announcement. Restrict to signed-in members (admins still
--    covered by is_admin()).
drop policy if exists "announcements: read sent or admin" on public.announcements;
create policy "announcements: read sent or admin" on public.announcements
  for select to authenticated
  using (is_admin() or sent_at is not null);

-- 4. Trigger functions must not be callable as RPC endpoints (Supabase
--    advisor). They run only from their triggers, never from RLS policies or
--    by users. The default EXECUTE grant is to PUBLIC, so revoke from PUBLIC
--    (revoking from anon/authenticated alone leaves the PUBLIC grant intact).
--
--    The RLS-helper definers (can_view, is_admin, current_user_tiers,
--    lesson_completable_by_member) are deliberately left callable: they are
--    referenced inside RLS policy expressions — revoking EXECUTE would break
--    gated-content reads — and only ever reveal the CALLER's own access state.
revoke execute on function public.protect_admin_columns() from public;
revoke execute on function public.enforce_session_capacity() from public;

-- ============================================================
-- 0023_admin_audit_log.sql
-- ============================================================
-- Admin audit trail. Sensitive admin actions — minting a member login link
-- (which grants sign-in as that member), deleting a member, changing admin
-- access — are recorded here so there is an accountable record of who did
-- what to whom. Super-admin readable; written only by the service role.
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id) on delete set null,
  actor_email text,
  action text not null,          -- e.g. 'login_link', 'delete_member', 'set_admin_access'
  target_profile_id uuid,        -- not an FK: survives the target's deletion
  target_email text,
  detail text,
  at timestamptz not null default now()
);

create index if not exists admin_audit_log_at_idx
  on public.admin_audit_log (at desc);

alter table public.admin_audit_log enable row level security;

-- Super Admin can read; nobody writes through the client (service role only).
create policy "admin_audit: super read" on public.admin_audit_log
  for select using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.admin_role = 'super'
    )
  );

-- ============================================================
-- 0024_perf_view_and_auth_activity.sql
-- ============================================================
-- Performance support objects (audit batch P).
--
-- 1) session_enrollment_counts: aggregate view so enrollment counts are one
--    query instead of downloading every enrollment row and counting in JS.
--    Service-role only — the aggregate is harmless, but there's no member
--    use case, so least privilege applies.
create or replace view public.session_enrollment_counts
  with (security_invoker = true) as
  select session_id, count(*)::int as enrolled
  from public.enrollments
  group by session_id;

revoke all on public.session_enrollment_counts from public, anon, authenticated;
grant select on public.session_enrollment_counts to service_role;

-- 2) auth_activity: invite/confirm/last-login timestamps for a specific set
--    of profile ids. Replaces paging the entire auth user list (up to 20
--    sequential Auth-admin API calls) on every Admin → Members view.
--    SECURITY DEFINER because auth.users isn't otherwise reachable through
--    PostgREST; execution restricted to the service role.
create or replace function public.auth_activity(ids uuid[])
returns table (
  id uuid,
  invited_at timestamptz,
  confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select u.id, u.invited_at, u.confirmed_at, u.last_sign_in_at, u.created_at
  from auth.users u
  where u.id = any(ids)
$$;

revoke execute on function public.auth_activity(uuid[]) from public, anon, authenticated;
grant execute on function public.auth_activity(uuid[]) to service_role;

-- ============================================================
-- 0025_sponsor_tier_hierarchy.sql
-- ============================================================
-- Sponsor tier hierarchy (Matt, 2026-07-17): replace the 3-value
-- sponsor_tier enum with the full 11-level ladder, top to bottom:
--   momentum_plus > title > platinum > gold > lunch > happy_hour >
--   breakfast > silver > coffee_break > community > partner
-- The column becomes text + CHECK so future tier edits don't need enum
-- surgery; ordering lives in lib/sponsor-tiers.ts.

alter table public.sponsors
  alter column tier drop default,
  alter column tier type text using tier::text;

-- Remap the rows seeded before the hierarchy existed.
-- The old 'title' tier meant "Momentum+ Sponsor".
update public.sponsors set tier = 'momentum_plus' where tier = 'title';

-- The 2026 event sponsors were parked under the old 'partner' tier —
-- restore their real packages (matched by seeded name).
update public.sponsors set tier = 'platinum'     where tier = 'partner' and lower(name) = 'iwat';
update public.sponsors set tier = 'gold'         where tier = 'partner' and lower(name) in ('middletown valley bank', 'martin''s potato rolls');
update public.sponsors set tier = 'silver'       where tier = 'partner' and lower(name) in ('arc human capital', 'saunders tax and accounting', 'smartypants medicine');
update public.sponsors set tier = 'coffee_break' where tier = 'partner' and lower(name) = 'rm benefits';
update public.sponsors set tier = 'happy_hour'   where tier = 'partner' and lower(name) = 'meinelschmidt distillery';
update public.sponsors set tier = 'breakfast'    where tier = 'partner' and lower(name) = 'gypsy soul';

-- The old 'community' tier held the trade/media partners — that's the
-- bottom 'partner' tier in the new ladder. (Order matters: the event-
-- sponsor remaps above already consumed the old 'partner' rows.)
update public.sponsors set tier = 'partner' where tier = 'community';

alter table public.sponsors
  add constraint sponsors_tier_check check (tier in (
    'momentum_plus', 'title', 'platinum', 'gold', 'lunch', 'happy_hour',
    'breakfast', 'silver', 'coffee_break', 'community', 'partner'
  )),
  alter column tier set default 'partner';

-- The enum is no longer referenced by any column.
drop type if exists sponsor_tier;

-- ============================================================
-- 0026_session_cancelled_status.sql
-- ============================================================
-- Sessions can be cancelled (audit batch F). Before this, a future-dated
-- session an admin wanted to call off had no honest state: it kept showing
-- "Upcoming" with a live Enroll button, and clicking it surfaced a raw RLS
-- error. Enum append is safe (no reorder).
alter type session_status add value if not exists 'cancelled';

-- ============================================================
-- 0027_sponsor_lifecycle.sql
-- ============================================================
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

-- ============================================================
-- 0028_speaker_lifecycle.sql
-- ============================================================
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

-- ============================================================
-- 0029_services.sql
-- ============================================================
-- Additional Services (Matt, 2026-07-17): SLC's service offerings listed in
-- the member portal, each with details and an external sign-up link.

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tagline text,
  description text,
  url text,                       -- external sign-up link
  price_label text,               -- optional, e.g. "$500/mo" or "Custom"
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.services enable row level security;

-- Members see active services; all writes go through the service role.
drop policy if exists services_member_read on public.services;
create policy services_member_read on public.services
  for select to authenticated
  using (active = true);

-- ============================================================
-- 0030_rooted_focus.sql
-- ============================================================
-- Rooted Focus (Matt, 2026-07-17): 90-minute recurring co-working sessions
-- led by the SLC team. They live in the sessions table with program =
-- 'rooted_focus', get their own member tab, can recur (the whole series
-- lands on a member's calendar), and can be hosted by an admin who is not
-- a speaker (host_name).

alter table public.sessions
  add column if not exists program text not null default 'standard',
  add column if not exists recurrence text,
  add column if not exists recurrence_until timestamptz,
  add column if not exists host_name text;

do $$ begin
  alter table public.sessions
    add constraint sessions_program_check
    check (program in ('standard', 'rooted_focus'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.sessions
    add constraint sessions_recurrence_check
    check (recurrence is null or recurrence in ('weekly', 'biweekly', 'monthly'));
exception when duplicate_object then null; end $$;

create index if not exists sessions_program_idx on public.sessions (program);

-- Migration 0020 switched sessions to column-level grants; the new columns
-- are schedule metadata (not join credentials) and must be member-readable.
grant select (program, recurrence, recurrence_until, host_name)
  on public.sessions to anon, authenticated;

-- ============================================================
-- 0031_announcement_deliveries.sql
-- ============================================================
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

-- ============================================================
-- 0032_analytics_aggregates.sql
-- ============================================================
-- Analytics aggregates (Batch G): the admin analytics page used to download
-- raw event rows and count in JS — PostgREST caps responses at 1,000 rows,
-- so busy tables silently under-reported (including sponsor-facing numbers).
-- These views do the counting in the database.

create or replace view public.sponsor_event_counts
  with (security_invoker = true) as
select
  sponsor_id,
  kind,
  count(*)::int as all_count,
  (count(*) filter (where at >= now() - interval '30 days'))::int as recent_count
from public.sponsor_events
group by sponsor_id, kind;

create or replace view public.resource_use_counts
  with (security_invoker = true) as
select
  resource_id,
  count(*)::int as all_count,
  (count(*) filter (where used_at >= now() - interval '30 days'))::int as recent_count
from public.resource_uses
group by resource_id;

create or replace view public.video_view_counts
  with (security_invoker = true) as
select
  video_id,
  count(*)::int as all_count,
  (count(*) filter (where watched_at >= now() - interval '30 days'))::int as recent_count,
  count(distinct profile_id)::int as unique_viewers
from public.video_views
group by video_id;

-- security_invoker: members querying these hit the underlying tables' RLS
-- (which denies them); the service role reads everything. Belt and braces:
revoke select on public.sponsor_event_counts from anon, authenticated;
revoke select on public.resource_use_counts from anon, authenticated;
revoke select on public.video_view_counts from anon, authenticated;

-- ============================================================
-- 0033_sponsor_profiles.sql
-- ============================================================
-- Sponsor profile pages (Matt, 2026-07-17): every sponsor gets a full-page
-- profile like speakers. Adds the long-form "about" text the profile shows
-- under the logo/tagline.

alter table public.sponsors
  add column if not exists description text;

-- ============================================================
-- 0034_growth_ops.sql
-- ============================================================
-- Growth & operations batch (Matt, 2026-07-17):
-- 1. Member directory contact sharing is strictly opt-in.
-- 2. Failed-payment recovery emails are journaled so each step sends once.
-- 3. Error reports are throttled server-side so one bug never storms Matt's
--    inbox.

alter table public.profiles
  add column if not exists share_contact boolean not null default false;

create table if not exists public.dunning_notices (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  step int not null,               -- 1 = immediate, 2 = day 3, 3 = day 6
  sent_at timestamptz not null default now(),
  primary key (membership_id, step)
);
alter table public.dunning_notices enable row level security;
-- No policies: service-role only.

create table if not exists public.error_reports (
  hash text primary key,           -- fingerprint of message+path
  message text not null,
  path text,
  count int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  last_emailed_at timestamptz
);
alter table public.error_reports enable row level security;
-- No policies: service-role only.

-- ============================================================
-- 0035_referrals_testimonials.sql
-- ============================================================
-- Referrals + testimonials (Matt, 2026-07-17).

-- Each member gets a shareable code (generated lazily on first visit to
-- their profile). /join?ref=CODE attributes the signup; when the referred
-- member's first payment lands, the referrer earns a free month.
alter table public.profiles
  add column if not exists referral_code text unique;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_profile_id uuid not null references public.profiles(id) on delete cascade,
  referred_profile_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  reward text,                     -- e.g. "stripe_credit" | "access_extended"
  created_at timestamptz not null default now(),
  unique (referred_profile_id)     -- one attribution per new member, ever
);
alter table public.referrals enable row level security;
-- No policies: service-role only.
create index if not exists referrals_referrer_idx
  on public.referrals (referrer_profile_id);

-- Member-submitted testimonials; admin approves before anything shows on
-- the public landing page.
create table if not exists public.testimonials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  name text not null,              -- display name, as the member wants it shown
  role_company text,               -- e.g. "Founder, Chen Creative"
  quote text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'hidden')),
  created_at timestamptz not null default now(),
  approved_at timestamptz
);
alter table public.testimonials enable row level security;
-- No policies: service-role only.

-- ============================================================
-- 0036_critical_fixes.sql
-- ============================================================
-- Critical fixes from the triple audit (Matt, 2026-07-18).

-- 1. Speaker memberships were impossible: the enum never had 'speaker', so
--    speaker onboarding / archive / reinstate membership writes all failed
--    (and the errors were ignored — fixed app-side in the same batch).
alter type membership_source add value if not exists 'speaker';

-- 2. Members could not see cancelled sessions AT ALL (the read policy
--    predates the cancelled status), so cancelling a session 404'd it for
--    members instead of showing the honest "Cancelled" state built for it.
drop policy if exists "sessions: read visible" on sessions;
create policy "sessions: read visible"
  on sessions for select
  using (
    is_admin()
    or (
      status in ('scheduled', 'live', 'completed', 'archived', 'cancelled')
      and can_view(min_access)
    )
  );

-- 3. Heal recurring (Rooted Focus) sessions the status cron already flipped
--    to completed after their first occurrence — the cron is now
--    recurrence-aware and keeps series in scheduled/live until the series
--    actually ends.
update sessions
   set status = 'scheduled'
 where recurrence is not null
   and status = 'completed'
   and (recurrence_until is null or recurrence_until > now());

-- ============================================================
-- 0037_sponsor_tier.sql
-- ============================================================
-- New member tier: sponsor — auto-applied to the user who runs a sponsor
-- page (Matt, 2026-07-18). Access is Pro-equivalent; gating and data
-- conversion live in 0038.
--
-- RUN THIS ALONE, BEFORE 0038. Postgres refuses to USE a new enum value in
-- the same transaction that adds it, so this must be its own SQL-editor run.
alter type access_tier add value if not exists 'sponsor';

-- ============================================================
-- 0038_batch_j.sql
-- ============================================================
-- Batch J: sponsor-tier gating + announcement correctness.
-- Requires 0037 (adds the 'sponsor' enum value) to have run FIRST, in its
-- own SQL-editor run.

-- 1. Sponsor tier is Pro-equivalent: it clears both the vip_plus and
--    pro_only gates, exactly like the access the reps held as comped Pro.
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
      (current_user_tiers() && array['tsls_vip','sub_annual','speaker','admin','pro','sponsor']::access_tier[])
    when required = 'pro_only' then
      (current_user_tiers() && array['pro','admin','sponsor']::access_tier[])
    else false
  end;
$$;

-- 2. Existing sponsor reps (completed a sponsor invite) move from their
--    comped Pro row to the sponsor tier. Seat members a sponsor comps keep
--    Pro — the tier marks who RUNS a sponsor page.
update memberships m
   set tier = 'sponsor'
  from sponsor_invites si
 where si.invited_profile_id = m.profile_id
   and si.completed_at is not null
   and m.source = 'sponsor'
   and m.tier = 'pro';

-- 3. Journal the community (#announcements) post per announcement, so
--    retrying a partially-failed send can't post the same message to chat
--    twice.
alter table announcements
  add column if not exists community_posted_at timestamptz;

-- ============================================================
-- 0039_sponsor_seats.sql
-- ============================================================
-- Sponsor team roles + self-service Sponsor Studio (Matt, 2026-07-18).
--
-- Every sponsor_members seat now carries a role:
--   owner   — the primary manager (completed the sponsor invite). Holds the
--             sponsorship's one free Momentum+ membership. Cannot be removed;
--             can promote/demote co-managers and transfer ownership.
--   manager — may edit the sponsor page. Only members holding a REGULAR
--             (non-sponsor-comped) membership can be promoted.
--   member  — VIP-ticket holder tied to the sponsor; no edit rights.

alter table sponsor_members
  add column if not exists role text not null default 'member';
alter table sponsor_members
  drop constraint if exists sponsor_members_role_check;
alter table sponsor_members
  add constraint sponsor_members_role_check
  check (role in ('owner', 'manager', 'member'));

-- Existing reps (whoever completed a sponsor invite) own their pages.
update sponsor_members sm
   set role = 'owner'
  from sponsor_invites si
 where si.sponsor_id = sm.sponsor_id
   and si.invited_profile_id = sm.profile_id
   and si.completed_at is not null;

-- Members can see their own seat rows — this is what makes the
-- "Sponsor Studio" nav entry appear for owners/managers.
drop policy if exists "sponsor_members: read own seat" on sponsor_members;
create policy "sponsor_members: read own seat"
  on sponsor_members for select
  using (profile_id = auth.uid());

-- ============================================================
-- 0040_legacy_tiers.sql
-- ============================================================
-- Legacy tier migration (Matt approved the mapping, 2026-07-18).
-- One-time conversion of pre-July-2026 membership rows to the current
-- member levels. Status and access_expires_at are untouched — only the
-- tier name changes, so nobody gains or loses time.
--
--   sub_annual  -> pro    (annual carried the old VIP-perk access; Pro is
--   tsls_vip    -> pro     today's equivalent, so they keep what they had)
--   sub_monthly -> basic
--   sub_3mo     -> basic
--   sub_6mo     -> basic
--   tsls_attendee -> basic

update memberships set tier = 'pro'
 where tier in ('sub_annual', 'tsls_vip');

update memberships set tier = 'basic'
 where tier in ('sub_monthly', 'sub_3mo', 'sub_6mo', 'tsls_attendee');

-- ============================================================
-- 0041_sponsor_ticket_override.sql
-- ============================================================
-- Per-sponsor VIP ticket override (Matt, 2026-07-18): a specific sponsor
-- can be granted a custom ticket count that replaces their tier's default
-- allotment. NULL = use the tier default from app_settings.
alter table sponsors
  add column if not exists ticket_override integer;

-- ============================================================
-- 0042_host_sponsor_tier.sql
-- ============================================================
-- Host Sponsor tier (Matt, 2026-07-20): the platform host's own business
-- (Sierra's), above Momentum+ Sponsor, with no end date. The sponsors.tier
-- CHECK from 0025 predates it — recreate the constraint with 'host' allowed.

alter table public.sponsors
  drop constraint if exists sponsors_tier_check;

alter table public.sponsors
  add constraint sponsors_tier_check check (tier in (
    'host', 'momentum_plus', 'title', 'platinum', 'gold', 'lunch',
    'happy_hour', 'breakfast', 'silver', 'coffee_break', 'community',
    'partner'
  ));

-- ============================================================
-- 0043_unique_session_recording.sql
-- ============================================================
-- One Library video per session, enforced by the DATABASE. The webhook,
-- the hourly recording poller, and the admin "Get recording" button all
-- guarded with check-then-insert, which races when two paths run in the
-- same moment (double Mux asset, double Library row, double notification).
--
-- Multiple NULL session_ids are allowed (manual uploads are unaffected —
-- UNIQUE treats NULLs as distinct).

-- Remove any duplicates that already slipped in: keep one row per session
-- (lowest id — videos has no created_at column, and id is deterministic).
delete from videos v
using videos keep
where v.session_id is not null
  and keep.session_id = v.session_id
  and keep.id < v.id;

alter table videos
  add constraint videos_session_id_unique unique (session_id);

-- ============================================================
-- 0044_notifications_scale.sql
-- ============================================================
-- ============================================================================
-- Momentum+ migration 0044: notifications at scale (350-member launch)
--
-- 1. (kind, link) index — reminder dedupe, announcement fallback dedupe, and
--    the speaker-notice delivery ledger all look rows up by kind + link; at
--    hundreds of members × daily notifications that lookup needs an index.
-- 2. created_at index — the nightly retention sweep (reconcile cron) deletes
--    old rows by age across all profiles; the existing (profile_id,
--    created_at) index doesn't serve a profile-less age scan.
-- ============================================================================

create index if not exists notifications_kind_link_idx
  on notifications (kind, link);

create index if not exists notifications_created_idx
  on notifications (created_at);

-- ============================================================
-- 0045_whitney.sql
-- ============================================================
-- ============================================================================
-- Momentum+ migration 0045: Whitney by SLC — Pro-only reflective guide.
-- Private per-member conversations with the Whitney AI guide. Members READ
-- their own conversations via RLS; all writes go through the server route
-- (service role), which enforces the Pro gate — access control lives in the
-- database per CLAUDE.md non-negotiable #1.
-- ============================================================================

create table whitney_conversations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index whitney_conversations_profile_idx
  on whitney_conversations (profile_id, updated_at desc);

create table whitney_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references whitney_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index whitney_messages_conversation_idx
  on whitney_messages (conversation_id, created_at);

alter table whitney_conversations enable row level security;
alter table whitney_messages enable row level security;

create policy "whitney conversations: read own"
  on whitney_conversations for select
  using (profile_id = auth.uid());

create policy "whitney messages: read own"
  on whitney_messages for select
  using (
    exists (
      select 1 from whitney_conversations c
      where c.id = conversation_id and c.profile_id = auth.uid()
    )
  );

-- ============================================================
-- 0046_remove_whitney.sql
-- ============================================================
-- ============================================================================
-- Momentum+ migration 0046: remove Whitney (Matt, 2026-07-20 — feature cut).
-- Reverses 0045: drops the conversation tables (messages cascade with them)
-- and clears the stored prompt override. Destructive by design — any test
-- conversations are permanently deleted.
-- ============================================================================

drop table if exists whitney_messages;
drop table if exists whitney_conversations;

delete from app_settings where key = 'whitney';

-- ============================================================
-- 0047_session_resources.sql
-- ============================================================
-- ============================================================================
-- Momentum+ migration 0047: per-session resources (SPEC.md §4 — the session
-- page and live-room drawer have always had a Resources tab; this gives it
-- data). Admins attach resources on the session editor; speakers attach them
-- to their own sessions from Speaker Studio. All writes go through server
-- actions (service role); members READ resources of any session they can see
-- (the subquery runs under the member's own sessions RLS).
-- ============================================================================

create table session_resources (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  name text not null,
  type text, -- short label shown under the name, e.g. "PDF", "Link", "Slides"
  url text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create index session_resources_session_idx
  on session_resources (session_id, sort, created_at);

alter table session_resources enable row level security;

create policy "session resources: member read"
  on session_resources for select
  using (
    exists (select 1 from sessions s where s.id = session_id)
  );

-- ============================================================
-- 0048_sms_and_push.sql
-- ============================================================
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

-- ============================================================
-- 0049_share_contact_grant.sql
-- ============================================================
-- ============================================================================
-- Momentum+ migration 0049: let members update their own share_contact
-- 0022 restricted profiles UPDATE to a column allowlist; 0034 then added
-- share_contact (Member Directory opt-in) without extending the allowlist,
-- so toggling it failed with "permission denied for table profiles".
-- RLS still limits updates to the member's own row; this only adds the
-- column. admin_title stays service-role-only by design — the profile
-- action now writes it server-side after an admin check.
-- ============================================================================

grant update (share_contact) on public.profiles to authenticated;

-- ============================================================
-- 0050_email_events.sql
-- ============================================================
-- ============================================================================
-- Momentum+ migration 0050: email delivery journal
-- SendGrid's Event Webhook reports what happened to each auth email
-- (delivered, opened, bounced, blocked, dropped, spam). Rows land here so
-- admins can answer "did the invite actually reach them?" from the portal
-- instead of the SendGrid dashboard (whose activity feed only keeps ~3
-- days). Service-role only: written by the webhook, read by admin pages.
-- ============================================================================

create table email_events (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  event text not null, -- delivered | open | bounce | blocked | dropped | spamreport
  reason text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index email_events_email_idx on email_events (email, occurred_at desc);
create index email_events_time_idx on email_events (occurred_at desc);

alter table email_events enable row level security;
-- No member policies on purpose — delivery data includes email addresses.

-- ============================================================
-- 0051_aspire_and_recategorize.sql
-- ============================================================
-- ============================================================================
-- Momentum+ migration 0051 (Sierra, 2026-07-23):
-- 1) Allow the 'aspire' program (Aspire2Achieve Growth — monthly drop-in
--    accountability sessions, same treatment as rooted_focus).
-- 2) Bulk-recategorize existing sessions into the new taxonomy (Matt chose
--    bulk over hand-editing). Rooted Focus rows become Productivity
--    Sessions; legacy educational categories fold into Monthly Educational
--    Session; Networking folds into Bonus Sessions.
-- ============================================================================

alter table sessions drop constraint if exists sessions_program_check;
alter table sessions
  add constraint sessions_program_check
  check (program in ('standard', 'rooted_focus', 'aspire'));

update sessions set category = 'Productivity Session'
  where program = 'rooted_focus';

update sessions set category = 'Monthly Educational Session'
  where program = 'standard'
    and category in ('Leadership', 'Wellness', 'Business');

update sessions set category = 'Bonus Sessions'
  where program = 'standard'
    and category = 'Networking';

-- ============================================================
-- 0052_sponsor_invite_prefill.sql
-- ============================================================
-- Sponsor-invite prefill (Matt, 2026-07-23): the TSLS Companion is the
-- single front door and the source of truth for a sponsor's details. When
-- an admin enters a sponsor there, TSLS pushes the business info onto a
-- Momentum+ sponsor invite so the rep's onboarding form is prefilled —
-- "enter once, appears in both" — and they just confirm and publish.
--
-- These live on sponsor_invites (service-role only, never member-facing),
-- so nothing surfaces to members until the rep completes onboarding and the
-- team activates the listing. Text-only; the logo stays a manual upload.

alter table public.sponsor_invites
  add column if not exists tagline text,
  add column if not exists description text,
  add column if not exists website text;

-- ============================================================
-- 0053_addon_and_speaker_month.sql
-- ============================================================
-- ============================================================================
-- Momentum+ migration 0053 (Matt, 2026-07-24):
-- 1) New 'addon' program — Add-on Sessions (speaker-led extras like the
--    monthly "AI use in business" series). They live on the Sessions tab
--    with normal enrollment, can be recurring or one-off, and are recorded.
-- 2) Speaker-of-the-month fields: each Momentum+ speaker is assigned one
--    calendar month (YYYY-MM); TSLS Main Speakers (first months of the
--    season) are flagged so the platform knows they are unpaid — everyone
--    else earns 15% of that month's monthly-equivalent membership revenue.
-- ============================================================================

alter table sessions drop constraint if exists sessions_program_check;
alter table sessions
  add constraint sessions_program_check
  check (program in ('standard', 'rooted_focus', 'aspire', 'addon'));

alter table speakers
  add column if not exists tsls_main_speaker boolean not null default false,
  add column if not exists speaker_month text
    check (speaker_month is null or speaker_month ~ '^\d{4}-(0[1-9]|1[0-2])$');

comment on column speakers.speaker_month is
  'Momentum+ speaker-of-the-month assignment, YYYY-MM (ET). Drives the Studio member-count/earnings card.';
comment on column speakers.tsls_main_speaker is
  'TSLS Main Speakers (event mainstage) are unpaid on Momentum+ — hides the earnings line, keeps the member-count card.';

-- ============================================================
-- 0054_tier_registry.sql
-- ============================================================
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

-- ============================================================
-- 0055_content_topics_and_season.sql
-- ============================================================
-- ============================================================================
-- Momentum+ migration 0055 (Sierra, 2026-07-28):
--
-- 1) TOPICS. A second, editable taxonomy for library content: one primary
--    topic and any number of secondary ones. This sits ALONGSIDE
--    sessions.category, which is a FORMAT ("Monthly Educational Session",
--    "Productivity Session") and answers a different question. Sierra's list
--    is what a member is actually browsing for, so it needs to be a table —
--    new speakers arrive with new topics and nobody should need a deploy.
--
-- 2) SEASON. The Library gains a season so Momentum+ Member can be held to
--    the current one while Pro sees the archive. A season opens on October 1
--    (Eastern), matching the speaker/sponsor lifecycle in 0028, and is
--    labelled by the year it opened: October 2026 onward is season 2026.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The taxonomy
-- ---------------------------------------------------------------------------
create table if not exists content_topics (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text not null default '',
  sort integer not null default 100,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

insert into content_topics (name, slug, sort) values
  ('Business Strategy, Systems & Growth',        'business-strategy',        10),
  ('Communication & Difficult Conversations',    'communication',            20),
  ('Emotional Intelligence',                     'emotional-intelligence',   30),
  ('Health, Wellness & Sustainable Leadership',  'health-wellness',          40),
  ('Leadership Foundations & Reflection',        'leadership-foundations',   50),
  ('Networks, Relationships & Connection',       'networks-relationships',   60),
  ('Purpose, Values & Identity',                 'purpose-values',           70),
  ('Resilience, Pivots & Adversity',             'resilience-pivots',        80),
  ('Self Leadership & Personal Growth',          'self-leadership',          90),
  ('Service, Community & Civic Leadership',      'service-community',       100),
  ('Team Culture & Environments',                'team-culture',            110)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Assignment. Sessions carry topics; a recording inherits its session's
--    topics when it is created, and can then be edited independently (a
--    standalone upload has no session to inherit from).
-- ---------------------------------------------------------------------------
create table if not exists session_topics (
  session_id uuid not null references sessions (id) on delete cascade,
  topic_id uuid not null references content_topics (id) on delete cascade,
  is_primary boolean not null default false,
  primary key (session_id, topic_id)
);

create table if not exists video_topics (
  video_id uuid not null references videos (id) on delete cascade,
  topic_id uuid not null references content_topics (id) on delete cascade,
  is_primary boolean not null default false,
  primary key (video_id, topic_id)
);

-- "Primary" means primary — one per item, enforced rather than trusted.
create unique index if not exists session_topics_one_primary
  on session_topics (session_id) where is_primary;
create unique index if not exists video_topics_one_primary
  on video_topics (video_id) where is_primary;

create index if not exists session_topics_topic_idx on session_topics (topic_id);
create index if not exists video_topics_topic_idx on video_topics (topic_id);

-- ---------------------------------------------------------------------------
-- 3. Sierra's four assignments.
--
-- Matched on session title rather than id, because ids differ between the
-- production database and any local copy. A title that does not match is a
-- no-op — the Control Center's topic editor is the fallback, not a failed
-- migration. Katie Nelson's secondary reads "Communication" in Sierra's
-- sheet; taken as the Communication & Difficult Conversations topic rather
-- than creating a near-duplicate.
-- ---------------------------------------------------------------------------
do $$
declare
  pair record;
  s_id uuid;
  t_id uuid;
begin
  for pair in
    select * from (values
      ('Resilience Under Pressure',            'Health, Wellness & Sustainable Leadership', true),
      ('Resilience Under Pressure',            'Resilience, Pivots & Adversity',            false),
      ('Resilience Under Pressure',            'Self Leadership & Personal Growth',         false),
      ('Crucial Conversations',                'Communication & Difficult Conversations',   true),
      ('Crucial Conversations',                'Team Culture & Environments',               false),
      ('Crucial Conversations',                'Emotional Intelligence',                    false),
      ('Human-Led, AI-Powered Sales',          'Business Strategy, Systems & Growth',       true),
      ('Human-Led, AI-Powered Sales',          'Networks, Relationships & Connection',      false),
      ('Human-Led, AI-Powered Sales',          'Communication & Difficult Conversations',   false),
      ('Principled Leadership in a Noisy World','Purpose, Values & Identity',               true),
      ('Principled Leadership in a Noisy World','Leadership Foundations & Reflection',      false),
      ('Principled Leadership in a Noisy World','Service, Community & Civic Leadership',    false)
    ) as v(session_title, topic_name, is_primary)
  loop
    select id into t_id from content_topics where name = pair.topic_name;
    if t_id is null then continue; end if;

    for s_id in
      select id from sessions
       where lower(btrim(title)) = lower(btrim(pair.session_title))
    loop
      insert into session_topics (session_id, topic_id, is_primary)
      values (s_id, t_id, pair.is_primary)
      on conflict (session_id, topic_id) do update set is_primary = excluded.is_primary;

      insert into video_topics (video_id, topic_id, is_primary)
      select v.id, t_id, pair.is_primary from videos v where v.session_id = s_id
      on conflict (video_id, topic_id) do update set is_primary = excluded.is_primary;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Season
-- ---------------------------------------------------------------------------

-- Nullable override. Null means "work it out from published_at", which is
-- right for every recording that exists today.
alter table videos add column if not exists season integer;
create index if not exists videos_season_idx on videos (season);

-- The season a moment falls in, labelled by the year that season opened.
-- October 1 Eastern is the boundary, matching speaker/sponsor expiry (0028).
create or replace function season_of(ts timestamptz)
returns integer
language sql
immutable
as $$
  select case
    when ts is null then null
    when extract(month from (ts at time zone 'America/New_York')) >= 10
      then extract(year from (ts at time zone 'America/New_York'))::integer
    else extract(year from (ts at time zone 'America/New_York'))::integer - 1
  end;
$$;

create or replace function current_library_season()
returns integer
language sql
stable
as $$
  select season_of(now());
$$;

-- Does the signed-in member's tier reach content from this season?
-- 'none' matches nothing (Momentum+ Lite has no Library at all).
create or replace function library_season_ok(v_season integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when is_admin() then true
    else exists (
      select 1
      from memberships m
      join member_tiers t on t.slug = m.tier::text
      where m.profile_id = auth.uid()
        and membership_grants_access(m.status, m.access_expires_at)
        and (
          t.library_scope = 'all_seasons'
          or (
            t.library_scope = 'current_season'
            and (v_season is null or v_season >= current_library_season())
          )
        )
    )
  end;
$$;

-- Fold the season into the videos read policy. Past-season recordings stop
-- being readable by a current-season tier; the library page re-fetches them
-- through the service role as metadata-only locked teasers, the same route
-- Pro-only content already takes.
drop policy if exists "videos: read published visible" on videos;
create policy "videos: read published visible"
  on videos for select
  using (
    is_admin()
    or (
      published_at is not null
      and can_view(min_access)
      and library_season_ok(coalesce(season, season_of(published_at)))
    )
  );

-- ---------------------------------------------------------------------------
-- 5. RLS for the taxonomy — readable by any member, written by admins.
-- ---------------------------------------------------------------------------
alter table content_topics enable row level security;
alter table session_topics enable row level security;
alter table video_topics enable row level security;

drop policy if exists "content_topics: read" on content_topics;
create policy "content_topics: read" on content_topics
  for select using (auth.uid() is not null);

drop policy if exists "content_topics: admin write" on content_topics;
create policy "content_topics: admin write" on content_topics
  for all using (is_admin()) with check (is_admin());

drop policy if exists "session_topics: read" on session_topics;
create policy "session_topics: read" on session_topics
  for select using (auth.uid() is not null);

drop policy if exists "session_topics: admin write" on session_topics;
create policy "session_topics: admin write" on session_topics
  for all using (is_admin()) with check (is_admin());

drop policy if exists "video_topics: read" on video_topics;
create policy "video_topics: read" on video_topics
  for select using (auth.uid() is not null);

drop policy if exists "video_topics: admin write" on video_topics;
create policy "video_topics: admin write" on video_topics
  for all using (is_admin()) with check (is_admin());

-- ============================================================
-- 0056_ad_manager.sql
-- ============================================================
-- ============================================================================
-- Momentum+ migration 0056: the ad manager (Matt, 2026-07-28).
--
-- Until now every ad slot was implicitly a SPONSOR slot: the rail took the
-- top three sponsor tiers, the in-body banner took Momentum+ Sponsor and
-- Title, and what appeared where was decided in code. That leaves no way to
-- run a house notice ("Rooted Focus starts Tuesday"), to promote something
-- that isn't a sponsor, or to reorder two ads sharing a slot.
--
-- Two tables:
--   ad_placements — the named slots a creative can occupy. Rows, not an
--                   enum, so a new slot in the UI doesn't need a migration.
--   ads           — the creatives. Optionally linked to a sponsor, in which
--                   case clicks and impressions keep flowing through the
--                   existing sponsor_events pipeline and keep showing up in
--                   Admin → Analytics.
-- ============================================================================

create table if not exists ad_placements (
  key text primary key,
  label text not null,
  description text not null default '',
  sort integer not null default 100
);

insert into ad_placements (key, label, description, sort) values
  ('rail',         'Right-hand rail',   'The sponsor column beside the main content. Desktop only.',        10),
  ('body_banner',  'In-page banner',    'Full-width strip inside the page body — dashboard and list pages.', 20),
  ('body_tile',    'In-page tile',      'Compact card sized for grid pages.',                                30),
  ('dashboard_top','Dashboard notice',  'Above the fold on the member dashboard. Best for house notices.',   40)
on conflict (key) do nothing;

create table if not exists ads (
  id uuid primary key default gen_random_uuid(),
  placement_key text not null references ad_placements (key) on delete cascade on update cascade,
  -- 'notice' is house copy (no advertiser); 'ad' is a paid or sponsor slot.
  kind text not null default 'ad' check (kind in ('ad', 'notice')),
  title text not null,
  body text not null default '',
  cta_label text,
  url text,
  image_url text,
  -- When set, this creative belongs to a sponsor and its clicks and views
  -- are attributed to them.
  sponsor_id uuid references sponsors (id) on delete set null,
  -- Position within the placement. Lower shows first; this is what the
  -- reorder arrows in the manager write.
  sort integer not null default 100,
  active boolean not null default true,
  -- Optional flight dates. Null on either side means "no bound that way".
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ads_placement_idx on ads (placement_key, sort);
create index if not exists ads_sponsor_idx on ads (sponsor_id);

-- ---------------------------------------------------------------------------
-- RLS
--
-- Members read what is live NOW — inactive rows and creatives outside their
-- flight dates never reach the browser, so a scheduled ad can be written in
-- advance without leaking. Admins read and write everything.
-- ---------------------------------------------------------------------------
alter table ad_placements enable row level security;
alter table ads enable row level security;

drop policy if exists "ad_placements: read" on ad_placements;
create policy "ad_placements: read" on ad_placements
  for select using (auth.uid() is not null);

drop policy if exists "ad_placements: admin write" on ad_placements;
create policy "ad_placements: admin write" on ad_placements
  for all using (is_admin()) with check (is_admin());

drop policy if exists "ads: read live" on ads;
create policy "ads: read live" on ads
  for select using (
    is_admin()
    or (
      auth.uid() is not null
      and active
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at > now())
    )
  );

drop policy if exists "ads: admin write" on ads;
create policy "ads: admin write" on ads
  for all using (is_admin()) with check (is_admin());

-- ============================================================
-- 0057_house_ads.sql
-- ============================================================
-- ============================================================================
-- Momentum+ migration 0057: the last hard-coded placements become ad rows
-- (Matt, 2026-07-28: "There should already be the Momentum+ Sponsor in 2
-- locations and the become a partner should be on here as well, they should
-- both be editable and moveable in here.")
--
-- Until now the Ad Manager showed its slots empty while the app still
-- rendered three things into them from code: the Momentum+ Sponsor's rail
-- card, its in-page banner/tile ad, and the "Become a partner" rail card.
-- This seeds those as real ads rows, and the renderers now read the rows.
--
-- Sponsor-linked rows are seeded with BLANK title/body/image on purpose:
-- blank fields inherit from the sponsor's profile (name, tagline, uploaded
-- ad creative) at render time, so the creative keeps being managed in
-- Admin → Sponsors and the row only decides placement, order, and flight.
-- Filling a field in the Ad Manager overrides the inherited value.
-- ============================================================================

-- The Momentum+ Sponsor's rail card (previously always led the rail).
insert into ads (placement_key, kind, title, sponsor_id, sort)
select 'rail', 'ad', '', s.id, 10
from sponsors s
where s.tier = 'momentum_plus'
  and s.archived_at is null
  and not exists (
    select 1 from ads a
    where a.placement_key = 'rail' and a.sponsor_id = s.id
  );

-- The in-page placements (previously: Momentum+ Sponsor and Title Sponsor,
-- rendered by code on every list/grid page). One row per placement so each
-- can be reordered or switched off on its own.
insert into ads (placement_key, kind, title, sponsor_id, sort)
select p.key, 'ad', '', s.id,
       case when s.tier = 'momentum_plus' then 10 else 20 end
from sponsors s
cross join (values ('body_banner'), ('body_tile')) as p (key)
where s.tier in ('momentum_plus', 'title')
  and s.archived_at is null
  and not exists (
    select 1 from ads a
    where a.placement_key = p.key and a.sponsor_id = s.id
  );

-- The "Become a partner" card (previously hard-coded at the rail's foot).
insert into ads (placement_key, kind, title, body, cta_label, url, sort)
select 'rail', 'notice', 'Become a partner',
       'Put your brand in front of a national community of engaged leaders. New partners are considered when 2027 sponsorships open in April.',
       'Become a Partner',
       'https://event.tristateleadershipsummit.com/sponsor',
       100
where not exists (
  select 1 from ads a
  where a.placement_key = 'rail' and a.kind = 'notice'
    and a.title = 'Become a partner'
);

-- ============================================================
-- 0058_ad_tier_targeting.sql
-- ============================================================
-- ============================================================================
-- Momentum+ migration 0058: tier-targeted ads (Matt, 2026-07-28: "I also
-- want to create ads specific to the tier of the member.")
--
-- An ads row gains an optional list of member-type slugs. Null or empty
-- means what it always meant: every member sees it. When set, only members
-- whose tier is in the list get the row — enforced here in RLS, so the
-- targeting can't be bypassed by a cached page or a future reader that
-- forgets to filter. Admins keep reading everything (the manager needs the
-- full list, and admins preview all placements).
--
-- Slugs are stored as plain text, matching memberships.tier — deliberately
-- no foreign key, same reasoning as memberships itself: an ad targeting a
-- tier that later gets archived should degrade to "nobody sees it", not
-- block the archive.
-- ============================================================================

alter table ads add column if not exists tiers text[];

drop policy if exists "ads: read live" on ads;
create policy "ads: read live" on ads
  for select using (
    is_admin()
    or (
      auth.uid() is not null
      and active
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at > now())
      and (
        tiers is null
        or tiers = '{}'
        or tiers && current_user_tiers()
      )
    )
  );

-- ============================================================
-- 0059_private_sessions.sql
-- ============================================================
-- ============================================================================
-- Momentum+ migration 0059: invite-only sessions (Matt, 2026-07-29).
--
-- "When creating a new A2A session I want to be able to select all, or
--  specific members … No one else should be aware of the session unless
--  they are specifically selected."
--
-- sessions.restricted + a session_invitees roster. The read policy is the
-- enforcement: a restricted session simply does not exist for anyone who
-- isn't on its roster (or an admin) — no list, no calendar entry, no
-- detail page, no 404-vs-403 tell. Built for Aspire2Achieve but nothing
-- here is A2A-specific.
-- ============================================================================

alter table sessions add column if not exists restricted boolean not null default false;

create table if not exists session_invitees (
  session_id uuid not null references sessions (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, profile_id)
);

create index if not exists session_invitees_profile_idx
  on session_invitees (profile_id);

alter table session_invitees enable row level security;

-- A member may see their own invitations (that's what lets the session
-- itself through the policy below); the full roster is admin-only.
drop policy if exists "session_invitees: read own" on session_invitees;
create policy "session_invitees: read own" on session_invitees
  for select using (is_admin() or profile_id = auth.uid());

drop policy if exists "session_invitees: admin write" on session_invitees;
create policy "session_invitees: admin write" on session_invitees
  for all using (is_admin()) with check (is_admin());

-- Same policy as 0036, plus the roster check for restricted rows.
drop policy if exists "sessions: read visible" on sessions;
create policy "sessions: read visible"
  on sessions for select
  using (
    is_admin()
    or (
      status in ('scheduled', 'live', 'completed', 'archived', 'cancelled')
      and can_view(min_access)
      and (
        not restricted
        or exists (
          select 1 from session_invitees i
          where i.session_id = sessions.id
            and i.profile_id = auth.uid()
        )
      )
    )
  );

-- ============================================================
-- 0060_restricted_column_grant.sql
-- ============================================================
-- ============================================================================
-- Momentum+ migration 0060: grant the `restricted` column (hotfix).
--
-- Migration 0020 switched sessions to COLUMN-level grants (to keep Zoom
-- join credentials server-side), which means every later column must be
-- granted explicitly — 0030 did this for the Rooted Focus columns, 0059
-- forgot to for `restricted`. Result: any member select naming the column
-- failed with "permission denied for table sessions" and the portal's
-- session queries errored (Matt, 2026-07-29, /dashboard).
-- ============================================================================

grant select (restricted) on public.sessions to anon, authenticated;

-- ============================================================
-- 0061_error_hits.sql
-- ============================================================
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

-- ============================================================
-- 0062_sponsor_prospects.sql
-- ============================================================
-- 2026 sponsorship catalog groundwork (Matt, 2026-07-29).
--
-- 1) New tiers from the 2026 package sheets: Event Program Sponsor plus the
--    three in-kind Media Partnership levels. The tier CHECK from 0042
--    predates them — recreate it.
-- 2) Prospects: interest-form submissions live in the sponsors table as
--    prospect rows — hidden from every member surface until an admin
--    confirms the sponsorship. Contact + notes columns hold what the form
--    captured. NO emails are sent to prospects by anything in the app.
-- 3) Seed the per-tier VIP ticket defaults from the sheets into
--    app_settings — counts the admin already set always win.

alter table public.sponsors
  drop constraint if exists sponsors_tier_check;

alter table public.sponsors
  add constraint sponsors_tier_check check (tier in (
    'host', 'momentum_plus', 'title', 'platinum', 'gold', 'lunch',
    'happy_hour', 'breakfast', 'silver', 'coffee_break', 'event_program',
    'community', 'strategic_media', 'regional_media', 'community_media',
    'partner'
  ));

alter table public.sponsors
  add column if not exists prospect boolean not null default false,
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists notes text;

-- Members never see prospect rows, even without the app-side filter.
-- (Admin UIs read through the service role, which bypasses RLS.)
drop policy if exists "sponsors: read for members" on public.sponsors;
create policy "sponsors: read for members"
  on public.sponsors for select
  using (
    is_admin()
    or (
      coalesce(prospect, false) = false
      and exists (
        select 1 from memberships m
        where m.profile_id = auth.uid()
          and m.status = 'active'
          and (m.access_expires_at is null or m.access_expires_at > now())
      )
    )
  );

-- VIP ticket defaults per the 2026 sheets (title 10, momentum_plus 2,
-- platinum 5, lunch 3, happy_hour 3, gold 5, breakfast 2, silver 2,
-- coffee_break 2, event_program 2, community 1; media 5/2/1). The jsonb
-- merge keeps existing keys: `defaults || value` lets stored counts win.
insert into public.app_settings (key, value, updated_at)
values ('sponsor_ticket_counts', '{}'::jsonb, now())
on conflict (key) do nothing;

update public.app_settings
set value = '{
  "title": 10, "momentum_plus": 2, "platinum": 5, "lunch": 3,
  "happy_hour": 3, "gold": 5, "breakfast": 2, "silver": 2,
  "coffee_break": 2, "event_program": 2, "community": 1,
  "strategic_media": 5, "regional_media": 2, "community_media": 1
}'::jsonb || value,
    updated_at = now()
where key = 'sponsor_ticket_counts';

-- ============================================================
-- 0063_sponsor_interest_import.sql
-- ============================================================
-- 2026 sponsor interest-list import (Matt, 2026-07-29). Source: the GHL
-- sponsor interest form export (event.tristateleadershipsummit.com/sponsor).
-- Requires 0062 (prospect + contact columns, new tiers).
--
-- Every business lands as a PROSPECT: hidden from members, no term, no
-- seats, no accounts — and NO emails. Matt confirms each one from Admin →
-- Sponsors once the agreement is signed.
--
-- ONE statement on purpose: the Supabase SQL editor runs statements over a
-- connection pool, so a temp table created in one statement is gone by the
-- next (the v1 of this file failed exactly that way). Data-modifying CTEs
-- keep the whole import atomic on a single connection.
--
-- Idempotent, and it never duplicates: a business already in the sponsors
-- table (several 2025-season sponsors re-submitted for 2026) is skipped by
-- the insert; instead the UPDATE gives its existing row the 2026 interest
-- note + any missing contact info (the UPDATE's snapshot predates the
-- insert, so freshly inserted prospects are untouched). Re-running is a
-- no-op: the insert finds the rows exist, the update sees their notes
-- already carry "2026 interest".

with v (name, tier, description, website, contact_name, contact_email, contact_phone, notes) as (
  values
  ('Meinelschmidt Distillery', 'happy_hour',
   '',
   'https://www.meineldistillery.com',
   'Cort Meinelschmidt', 'cort@meineldistillery.com', '+13019928777',
   '2026 interest: Networking Happy Hour Sponsor ($6,500). Also owns Veva''s on Potomac (vevasonpotomac.com). Description coming from their marketing contact. Submitted Jul 22, 2026.'),

  ('TOBE DesignGroup', 'silver',
   'TOBE DesignGroup is an award winning interior architecture + design firm. Our areas of practice include commercial, multifamily, and residential spaces. Design is personal. It''s more than creating beautiful interiors—it''s about understanding the people who will live, work, gather, and grow within them. At TOBE DesignGroup, we believe the strongest projects begin with trust, collaboration, and a genuine commitment to understanding what matters most.',
   'https://www.tobedesigngroup.com',
   'Todd Howard Ezrin', 'todd@tobedesigngroup.com', '+13016566600',
   '2026 interest: Silver Sponsor ($2,500). Principal (pronounced "Toby"). Submitted Jul 18, 2026.'),

  ('Graphics Universal, Inc.', 'silver',
   'Graphics Universal, Inc. is a label and commercial print manufacturer specializing in high-quality pressure-sensitive labels and custom printing services. The company provides innovative print solutions designed to enhance brand awareness, product presentation and overall operational efficiency.',
   'https://www.graphicsuniversal.com',
   'Adam Wiestling', 'adam@graphicsuniversal.com', '+17178169999',
   '2026 interest: Silver Sponsor ($2,500). Partnership previously discussed with Sierra. Sales Representative. Submitted Jun 25, 2026.'),

  ('Connect Films', 'silver',
   'At Connect Films, we actually don''t sell videos. We sell strategic clarity. Most of our clients come to us because there is a gap between how brilliant they are and how the market perceives them. We build the narrative strategy to close that gap, and the video is just the vehicle we use to deliver it.',
   'https://www.connectfilms.com',
   'Josh Youngbar', 'josh@connectfilms.com', '+13019911642',
   '2026 interest: Silver Sponsor ($2,500) — proposes trade for video production. Founder. Submitted Jun 18, 2026.'),

  ('Allegany County Chamber of Commerce', 'community',
   'The Allegany County Chamber of Commerce serves as a valued investment and resource for the business community through leadership, advocacy, education, and networking.',
   'https://alleganycountychamber.com',
   'Juli McCoy', 'juli@alleganycountychamber.com', '+13017222820',
   '2026 interest: Community Sponsor ($750). President & CEO. Submitted Jun 2, 2026.'),

  ('Frederick County Chamber of Commerce', 'community',
   'The Frederick County Chamber of Commerce serves as the voice of business within Frederick County, and provides strategic leadership and engagement in building the future of business and the community through information, collaboration, advocacy and services on behalf of the employers in our community.',
   'https://www.frederickchamber.org',
   'Casey Beins', 'cbeins@frederickchamber.org', '+12408156801',
   '2026 interest: Community Sponsor ($750) — proposes trade. Director of Marketing & Communications. Submitted Jun 1, 2026.'),

  ('Smartypants Medicine', 'silver',
   'Smartypants Medicine delivers personalized, convenient, affordable primary care to Winchester, VA and beyond. As a Direct Primary Care practice, we offer direct communication with your primary care provider via email, call, text, telehealth, office visits, and house calls. We work with both individuals and employers. Smart patients. Smart Healthcare. Smartypants Medicine.',
   'https://smartypantsmedicine.com',
   'Kelly Botta', 'kelly.a.botta@gmail.com', '+15406926132',
   '2026 interest: Silver Sponsor ($2,500) — "I think this is the level I told Sierra we wanted". President / Founder (pronounced BOT-ahh). Submitted May 14, 2026.'),

  ('RM Benefits', 'coffee_break',
   'RM Benefits includes RM Benefits of Maryland (owned by Rose McNeely) and RM Benefits Retirement Consulting (owned by Trish Davies). Together we offer complete, comprehensive, and custom employee benefit packages to attract and retain the best.',
   'https://www.rmbenefitsmd.com',
   'Trish Davies', 'trish.davies@lpl.com', '+12404226760',
   '2026 interest: Coffee Break Sponsor ($2,500). Referred by Mary Sue Dahill after attending a previous event. NOTE: exclusive package — River Bottom Roasters asked for it too. Submitted May 11, 2026.'),

  ('Saunders Tax and Accounting', 'silver',
   'Less Taxing Life, More Prosperous Solutions. Saunders Tax & Accounting helps individuals and business owners simplify the financial side of life and business. Through proactive tax planning, accounting, and strategic guidance, we help clients reduce tax burdens, make confident decisions, and create stronger financial outcomes.',
   'https://www.saunderstax.com',
   'Bev Stitely', 'bevstitely@saunderstax.com', '+13017142071',
   '2026 interest: Silver Sponsor ($2,500). Wants a book table (free or selling) matched with other sponsor tables, branded water bottles for the day, and is interested in the monthly program. President. Submitted Apr 27, 2026 (first: Jul 31, 2025).'),

  ('Humphrey''s Cleaning Service LLC', 'community',
   'At Humphrey''s Cleaning Service, we don''t just clean - we elevate your workplace. Our trained, reliable team tackles the messes others miss, creating healthier, safer environments for your employees and clients.',
   'https://www.humphreyclean.com',
   'William Humphrey', 'william@humphreyclean.com', null,
   '2026 interest: Community Sponsor ($750). Already bought his own ticket — the sponsorship ticket goes to Kevin Taylor, Director of Specialty Services. Chief Experience Officer. Submitted Sep 10, 2025.'),

  ('Wingman Executive Coaching', 'community',
   'Eric "Rabbit" Jorgensen is a former U.S. Air Force colonel and fighter pilot, who is now a leadership coach wingman certified by the International Coaching Federation, with a Doctor of Education degree specializing in human and organizational learning. Rabbit supports executives and others who are ready to propel their leadership performance and outcomes to new heights, empowered by a deep sense of gravity-defying purpose.',
   'https://wingmanexecutivecoaching.com',
   'Eric "Rabbit" Jorgensen', 'eric@wingmanexecutivecoaching.com', null,
   '2026 interest: Community Sponsor ($750). Founder / Executive Coach. Submitted Sep 8, 2025.'),

  ('Labers Office Furniture', 'community',
   'Mark and Kim Raidt – the owners since 2004 – have expanded the traditional operations of Labers to include contemporary office furniture, systems, supplies and countless other items needed at the office – all at heavily discounted prices. Labers is located at 1344 Wesel Boulevard in Hagerstown, just off Interstates 70 and 81.',
   'https://www.labersfurniture.com',
   'Kim Raidt', 'kim@labersfurniture.com', '+13019927878',
   '2026 interest: Community Sponsor ($750) — trade sponsorship for stools for the host to use during the day. COO. Submitted Sep 8, 2025.'),

  ('Edward Jones (Will Lawrence)', 'community',
   'Financial Planning and Wealth Management.',
   'https://www.edwardjones.com',
   'Will Lawrence', 'will.lawrence@edwardjones.com', null,
   '2026 interest: Community Sponsor ($750), split 4 ways. Financial Advisor. Submitted Sep 2, 2025.'),

  ('F&M Trust', 'community',
   '',
   'https://fmtrust.bank',
   'Diana Serna-Serrano', 'diana.serna-serrano@f-mtrust.com', null,
   '2026 interest: Community Sponsor. Looking at purchasing a couple of tickets; asked for proof of logo usage; company description to come. Marketing & Communications Manager. Submitted Aug 29, 2025.'),

  ('Martinsburg-Berkeley County Chamber of Commerce', 'community',
   'The Martinsburg-Berkeley County Chamber of Commerce is a dynamic organization dedicated to promoting economic growth, fostering connections, and supporting businesses of all sizes throughout the Eastern Panhandle. The Chamber offers networking opportunities, professional development, advocacy, and community engagement.',
   'https://www.berkeleycounty.org',
   'Kristie Hadley', 'kristie@berkeleycounty.org', '+13042674841',
   '2026 interest: Community Sponsor — prefers the sponsorship be in trade for marketing. President & CEO. Submitted Aug 29, 2025.'),

  ('SERVPRO of Washington County', 'community',
   'When disaster strikes, SERVPRO of Washington County strikes back fast. We provide 24/7 emergency mitigation, restoration, and cleanup services for water, fire, mold, and storm damage. From board-ups and tarping to full rebuilds, we protect and restore residential and commercial properties with speed and care.',
   'https://www.servprowashingtoncounty.com',
   'Donna Jean Digman', 'ddigman@servpro10664.com', '+14438650321',
   '2026 interest: Community Sponsor. Form filed under "SERVPRO of Baltimore''s Inner Harbor"; description and website are Washington County. Business Development Manager. Submitted Aug 28, 2025.'),

  ('CMG Home Loans (Joe Gillis)', 'community',
   'Joe Gillis — Your Home Loan Coach. CMG Home Loans — Every Customer, Every Time, No Exceptions, No Excuses.',
   'https://www.cmghomeloans.com/mysite/joe-gillis',
   'Joe Gillis', 'jgillis@cmghomeloans.com', '+13017884772',
   '2026 interest: Community Sponsorship ($750). Loan Officer. Submitted Aug 28, 2025.'),

  ('Middletown Valley Bank', 'lunch',
   'Since 1908, Middletown Valley Bank has been the cornerstone for our customers'' financial planning. Our exceptional customer service combined with state-of-the-art technology provides our customers with the best banking experience.',
   'https://mvbbank.com',
   'Matt South', 'msouth@mvbbank.com', null,
   '2026 interest: LUNCH Sponsor ($6,500). BJ Goetz, President & CEO, plans to speak on their behalf at the event. Contact: Matt South, Community Relations Officer. Submitted Aug 26, 2025.'),

  ('Martin''s Potato Rolls', 'community',
   'Martin''s is a family owned and operated consumer goods company focused on baking high-quality bread and roll products using high-quality ingredients — rigorously dedicated to extraordinary taste, quality, and customer service. Since the 1950s the business has grown from a home garage into two commercial baking plants.',
   'https://www.potatorolls.com',
   'Wendy Cowan', 'wcowan@potatorolls.com', null,
   '2026 interest: Community Sponsor. Will put a pack of Sweet Party Potato Rolls in the bags. Marketing Manager. Submitted Aug 11, 2025.'),

  ('GS Images', 'community',
   'GS Images is a sign company specializing in large format displays, vehicle lettering and wraps, banners, posters, decals of all sizes and shapes and many other graphic products.',
   'https://gsimages.com',
   'Doug Wright', 'dwright@gsimages.com', null,
   '2026 interest: Community Sponsor. President. Submitted Aug 4, 2025.'),

  ('Hagerstown Magazine', 'community_media',
   'Hagerstown Magazine is the area''s premiere lifestyle publication, featuring quality-of-life stories about dining, seniors, events, business and other positive content.',
   'https://www.hagerstownmagazine.com',
   'Chuck Boteler', 'cboteler@hagerstownmag.com', null,
   '2026 interest: Community Media Partner — in-kind value $1,465: half-page print ad, one eblast, one web banner, one social media feature post. Business Development Specialist. Submitted Jul 31, 2025.'),

  ('Sterling Settlement Services', 'community',
   'Sterling Settlement Services is a leading settlement company, renowned for its exceptional handling of transactions across the four-state area. Our reputation is built on a foundation of trust, efficiency, and a commitment to providing unparalleled service to our clients.',
   'https://www.sterlingsettle.com',
   'Michelle Compton', 'michelle@sterlingsettle.com', null,
   '2026 interest: Community Sponsor. Owner. Submitted Jul 31, 2025.'),

  ('River Bottom Roasters', 'coffee_break',
   'River Bottom Roasters cares about quality ingredients, ethical sourcing, fairness in trade and giving back to our communities. We don''t just want to make super delicious coffee, we want to make a difference in our local and international communities.',
   null,
   'V. Craig Campbell', 'riverbottomroasters@gmail.com', '+13015739070',
   '2026 interest: Coffee Break Sponsor. NOTE: exclusive package — RM Benefits asked for it too. Owner. Submitted Jul 30, 2025.'),

  ('Barley Snyder', 'platinum',
   'Barley Snyder is a strategically focused law firm representing businesses, organizations and individuals in all major areas of civil law. With offices throughout Pennsylvania and Maryland, the firm''s more than 130 attorneys provide innovative and effective representation to a wide range of clients.',
   'https://www.barley.com',
   'Jennifer Mowen', 'jmowen@barley.com', null,
   '2026 interest: Platinum Sponsor ($7,500). Attorney Paul Minnich is personally contributing to cover the cost of the sponsorship. Marketing Manager. Submitted Jul 28, 2025.'),

  ('D.L. Martin Company', 'community',
   'Our people are passionate about our purpose and values. We are sought after and valued by our customers. We are a place where people want to work — a culture of safety, innovation, opportunity and growth with advanced technology and tools.',
   'https://www.dlmartin.com',
   'Preston Spahr', 'pspahr@dlmartin.com', null,
   '2026 interest: Community ($750), in support of Eric Murr. Chairman of the Board. Submitted Jul 25, 2025.'),

  ('Shippensburg Area Chamber of Commerce', 'community',
   'The Shippensburg Area Chamber of Commerce is dedicated to supporting local businesses and fostering community growth. We provide networking opportunities, advocacy, and resources to help businesses thrive while promoting Shippensburg as a great place to live, work, and visit.',
   'https://shippensburg.org',
   'Wendy Kipe', 'director@shippensburg.org', null,
   '2026 interest: in-kind promotion (Chamber website feature, Tuesday e-newsletter, flyer in the printed Chamberline) — a Community Media Partner candidate. President. Submitted Jul 25, 2025.'),

  ('Washington County Chamber of Commerce', 'community',
   'Growth. Community. Success. Established in 1919, the mission of the Chamber is to foster and maintain a thriving business climate in which its members and community can grow and prosper. Members include more than 670 organizations representing over 40,000 local jobs across a wide variety of industries.',
   'https://www.hagerstown.org',
   'Maddie Monica', 'maddie@hagerstown.org', null,
   '2026 interest: Community Sponsor — trade for 5 Chamber eCasts. Marketing & Events. Submitted Jul 23, 2025.'),

  ('Hancock Media', 'community',
   'Hancock Media is a creative studio offering branding, website, print, and social content design and management — Design to Make a Difference. We help businesses grow through strategic, purpose-driven design while staying rooted in community impact.',
   'https://www.mhancockmedia.com',
   'Meredith Hancock', 'meredith@mhancockmedia.com', null,
   '2026 interest: package unclear on the form. Creative studio — possible Media Partner. Owner. Submitted Jul 9, 2025.'),

  ('Top of Virginia Regional Chamber', 'community',
   'The Top of Virginia Regional Chamber is the champion of more than 850 business members and their employees in Clarke County, Frederick County, and Winchester, Virginia — the premier business networking and advocacy organization in the region.',
   'https://www.regionalchamber.biz',
   'Cynthia Schneider', 'cschneider@regionalchamber.biz', '+15406644390',
   '2026 interest: Community — barter for TVRC marketing package valued $750 (dedicated email blast, Top of Mind ads, half-page newsletter ad). CEO. Submitted Jul 9, 2025.'),

  ('Work Smarter Digital', 'momentum_plus',
   'Work Smarter Digital helps service-based businesses double their revenue without sacrificing the personal, relationship-based sales that define their success. Our Revenue Accelerator System provides teams with automated, scalable sales pipelines, intelligent CRM, and strategic follow-ups that enhance consultative selling rather than replace it.',
   'https://www.worksmarterdigital.com',
   'Mary Sue Dahill', 'marysue@worksmarterdigital.com', null,
   '2026 interest: Momentum+ Sponsor ($10,000) — requested 3 payments, 50% in trade. CEO. Submitted Jun 30, 2025.')
),

-- New businesses land as hidden prospects. No term, no rail, no emails.
ins as (
  insert into public.sponsors
    (name, tier, description, website, rail_active, expires_at, prospect,
     contact_name, contact_email, contact_phone, notes)
  select v.name, v.tier, nullif(v.description, ''), v.website, false, null, true,
         v.contact_name, v.contact_email, v.contact_phone, v.notes
  from v
  where not exists (
    select 1 from public.sponsors s where lower(s.name) = lower(v.name)
  )
  returning 1
)

-- Businesses already in the table (2025 roster re-submitting for 2026) keep
-- their tier/description/status; they just get the 2026 interest note and
-- any missing contact info. The statement snapshot predates ins, so rows
-- inserted above are not touched; rows that already carry a 2026 note are
-- skipped, which makes re-runs no-ops.
update public.sponsors s
set contact_name  = coalesce(s.contact_name,  v.contact_name),
    contact_email = coalesce(s.contact_email, v.contact_email),
    contact_phone = coalesce(s.contact_phone, v.contact_phone),
    notes = case
      when coalesce(s.notes, '') = '' then v.notes
      else s.notes || E'\n' || v.notes
    end
from v
where lower(s.name) = lower(v.name)
  and position('2026 interest' in coalesce(s.notes, '')) = 0;

-- ============================================================
-- 0064_sponsor_september_terms.sql
-- ============================================================
-- Sponsor seasons move to a September 1 clock (Matt, 2026-07-29): every
-- sponsorship is revealed on September 1 and ends September 1 of the
-- following year. This pins every non-archived, term-bearing sponsor to
-- September 1, 2027 (00:00 ET = 04:00 UTC — September is EDT). Prospects
-- (no term yet) pick up the same date when confirmed; ongoing sponsors
-- (expires_at null, e.g. the Host Sponsor) stay ongoing; the archive is
-- untouched. Speakers keep their October 1 cycle.
--
-- HEADS-UP on visibility: the live window runs from expiry minus one year,
-- so a Sept 1, 2027 expiry means the roster is member-visible from
-- September 1, 2026 — sponsors visible today under the old October term go
-- pre-season-hidden until then (Matt confirmed the Sept 1 reveal,
-- 2026-07-29). "Make ongoing" on any sponsor keeps them up continuously.

update public.sponsors
set expires_at = '2027-09-01T04:00:00Z'
where archived_at is null
  and expires_at is not null;

-- Their teams' sponsor-comped access follows the term (same rule as
-- "Make ongoing"/"Set season end"). VIP-ticket comps keep their own
-- 3-month clock.
update public.memberships m
set access_expires_at = '2027-09-01T04:00:00Z'
from public.sponsor_members sm
join public.sponsors s on s.id = sm.sponsor_id
where m.profile_id = sm.profile_id
  and s.archived_at is null
  and s.expires_at = '2027-09-01T04:00:00Z'
  and m.source = 'sponsor'
  and m.status = 'active'
  and m.tier <> 'vip';

-- ============================================================
-- 0065_sponsor_april_terms.sql
-- ============================================================
-- Correction to 0064 (Matt, 2026-07-29): the sponsor lifecycle is APRIL 1
-- to April 1, not September 1. Every current sponsor belongs to the season
-- already in progress (April 1, 2026 – April 1, 2027), so they are all
-- member-visible NOW and come down April 1, 2027 (00:00 ET = 04:00 UTC —
-- April is EDT). This re-pins every non-archived, term-bearing sponsor,
-- whether 0064 ran before it or not. Ongoing sponsors (expires_at null,
-- e.g. the Host Sponsor) stay ongoing; the archive is untouched. Speakers
-- keep their October 1 cycle.

update public.sponsors
set expires_at = '2027-04-01T04:00:00Z'
where archived_at is null
  and expires_at is not null;

-- Their teams' sponsor-comped access follows the term (same rule as
-- "Make ongoing"/"Set season end"). VIP-ticket comps keep their own
-- 3-month clock.
update public.memberships m
set access_expires_at = '2027-04-01T04:00:00Z'
from public.sponsor_members sm
join public.sponsors s on s.id = sm.sponsor_id
where m.profile_id = sm.profile_id
  and s.archived_at is null
  and s.expires_at = '2027-04-01T04:00:00Z'
  and m.source = 'sponsor'
  and m.status = 'active'
  and m.tier <> 'vip';

-- ============================================================
-- 0066_sponsors_footer_placement.sql
-- ============================================================
-- Momentum+ migration 0066 (Matt, 2026-07-29): the "Become a partner"
-- banner at the bottom of the member Sponsors page joins the Ad Manager —
-- until now its copy and link were hard-coded in the page. This adds the
-- slot and seeds the current banner as an editable notice row; the page
-- now renders whatever this slot holds (falling back to the old copy only
-- if the slot is emptied of active rows).

insert into ad_placements (key, label, description, sort)
values (
  'sponsors_footer',
  'Sponsors page footer',
  'The banner at the bottom of the member Sponsors page — the "Become a partner" call-to-action lives here.',
  50
)
on conflict (key) do nothing;

insert into ads (placement_key, kind, title, body, cta_label, url, sort)
select 'sponsors_footer', 'notice', 'Become a partner',
       'Put your brand in front of a national community of engaged leaders — tasteful, integrated, and measured. This season''s sponsorships are full; submissions are considered when 2027 sponsorships open in April 2027.',
       'Sponsorship Interest Form',
       'https://event.tristateleadershipsummit.com/sponsor',
       10
where not exists (
  select 1 from ads a where a.placement_key = 'sponsors_footer'
);

-- ============================================================
-- 0067_sponsor_tiers_sync.sql
-- ============================================================
-- Momentum+ migration 0067: the synced sponsorship-tier catalog (Matt,
-- 2026-07-29). TSLS owns the catalog — its Admin → Event Planning editor
-- pushes the full list here via /api/bridge/tiers on every save. Momentum+
-- reads it for tier order, labels, and pricing; until the first push
-- arrives the code-defined 2026 catalog keeps everything rendering.

create table public.sponsor_tiers (
  value text primary key,
  label text not null,
  price int not null default 0,
  in_kind boolean not null default false,
  available int,
  sold_out boolean not null default false,
  vip_tickets int not null default 0,
  highlights text[] not null default '{}',
  sort int not null default 100,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.sponsor_tiers enable row level security;

create policy sponsor_tiers_read on public.sponsor_tiers
  for select to authenticated using (true);

-- ============================================================
-- 0068_scheduled_gifts.sql
-- ============================================================
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

-- ============================================================
-- 0069_scale_hardening.sql
-- ============================================================
-- ============================================================================
-- 0069: scale hardening for 2,500 concurrent members (capacity review,
-- 2026-07-30). Three independent pieces:
--
-- 1. sponsor_events dedup index — every portal page view runs a dedup check
--    filtered by (profile_id, kind, at); the table only had a sponsor_id
--    index, so that check was a growing sequential scan.
-- 2. auth_user_id_by_email() — replaces paging the whole Auth admin user
--    list (25 API calls per lookup, hard ceiling at 5,000 users) with one
--    indexed query. Security definer; service-role only.
-- 3. profiles.stream_synced_key — marker so Stream channel membership is
--    provisioned once per member per tier-change instead of ~16 Stream API
--    calls on every community page open.
-- ============================================================================

-- 1 ──────────────────────────────────────────────────────────────────────────
create index if not exists sponsor_events_dedupe_idx
  on public.sponsor_events (profile_id, kind, at desc);

-- 2 ──────────────────────────────────────────────────────────────────────────
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.auth_user_id_by_email(text) from public;
revoke all on function public.auth_user_id_by_email(text) from anon;
revoke all on function public.auth_user_id_by_email(text) from authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;

-- 3 ──────────────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists stream_synced_key text;

-- ============================================================
-- 0070_backfill_bridge_role_expiry.sql
-- ============================================================
-- ============================================================================
-- 0070: backfill season expiries onto bridge-provisioned speaker/sponsor
-- memberships (security audit, 2026-07-30).
--
-- The TSLS bridge ("Open Momentum+" tap by a speaker or sponsor) provisioned
-- source='zapier' memberships with NO expiry — permanent Pro-level access
-- that the Oct 1 speaker clock and Apr 1 sponsor clock could never touch,
-- and that the real onboarding flows couldn't see (they look up their own
-- source values). The code now stamps the season end at grant time; this
-- fixes the rows already minted.
--
-- Dates are this season's boundaries (Oct 1 00:00 ET = 04:00 UTC is always
-- inside daylight time; sponsors confirmed before Oct 1 2026 run through
-- Apr 1 2027 per the April→April rule).
-- ============================================================================

update public.memberships
set access_expires_at = '2026-10-01T04:00:00Z'
where source = 'zapier'
  and tier = 'speaker'
  and access_expires_at is null;

update public.memberships
set access_expires_at = '2027-04-01T04:00:00Z'
where source = 'zapier'
  and tier = 'sponsor'
  and access_expires_at is null;

-- ============================================================
-- 0071_rls_rate_limit_hardening.sql
-- ============================================================
-- ============================================================================
-- 0071: RLS + rate-limit hardening (security verification sweep, 2026-07-30).
--
-- Three findings from the full RLS/abuse audit:
--
-- 1. sponsor_events allowed authenticated INSERT (0020) even though the only
--    legitimate writer — /api/sponsors/track — inserts through the service
--    role after per-member dedup. The policy let a member bypass that dedup
--    entirely with direct PostgREST inserts and inflate any sponsor's
--    impression/click stats. Sponsor-facing numbers must be trustworthy, so
--    the member-facing write path is closed; the service role is unaffected.
--
-- 2. The videos read policy (0055) checked published/tier/season but never
--    archived_at (0028) — archived library items stayed directly readable
--    via PostgREST even though every app query hides them.
--
-- 3. action_events: a tiny durable ledger for rate limiting. The help-chat
--    limiter lived in a per-process Map, which resets on every cold start
--    and doesn't hold across serverless instances — so the "20 AI calls per
--    hour" cap was advisory. Service-role only; lib/throttle.ts is the API.
-- ============================================================================

-- 1. sponsor_events: service-role writes only.
drop policy if exists "sponsor_events: insert authenticated" on public.sponsor_events;
revoke insert on public.sponsor_events from authenticated;

-- 2. Archived videos disappear from direct reads too.
drop policy if exists "videos: read published visible" on videos;
create policy "videos: read published visible"
  on videos for select
  using (
    is_admin()
    or (
      published_at is not null
      and archived_at is null
      and can_view(min_access)
      and library_season_ok(coalesce(season, season_of(published_at)))
    )
  );

-- 3. Durable action ledger for rate limits (help chat, speaker questions).
create table if not exists action_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);

create index if not exists action_events_lookup_idx
  on action_events (profile_id, action, created_at desc);

alter table action_events enable row level security;
-- No policies: service-role only, like the other ledgers.

-- ============================================================
-- 0072_bonus_consolidation.sql
-- ============================================================
-- Consolidate the two "extra session" concepts into one (Matt, 2026-08-05).
--
-- Background: there were two overlapping ideas —
--   * the `addon` PROGRAM (a real speaker-led extra: own badge, recurring,
--     recorded to the Library), and
--   * a "Bonus Sessions" CATEGORY tag that could be stuck on a standard
--     session but carried no special behavior.
--
-- We keep the functional machinery (the `addon` program) and rename it,
-- member-facing, to "Bonus" everywhere in the app. Here we fold any legacy
-- standard sessions that were merely tagged with the "Bonus Sessions" (or
-- stray "Add-on Sessions") category into the addon program so there is a
-- single mechanism going forward. Idempotent — safe to re-run.

update sessions
set program = 'addon'
where program = 'standard'
  and category in ('Bonus Sessions', 'Add-on Sessions');

-- ============================================================
-- 0073_branching_out.sql
-- ============================================================
-- Branching Out — the SLC podcast tab (Matt, 2026-08-05).
--
-- Episodes live on YouTube; a cron auto-pulls new uploads from the channel's
-- public feed (title, show notes, thumbnail, date) so nothing needs manual
-- upload each week. Admins can also add past episodes by hand and hide any
-- episode. "Grow on the Go" leaves the nav at the same time (nav-only change,
-- its feature row stays).

create table if not exists podcast_episodes (
  id uuid primary key default gen_random_uuid(),
  -- The 11-char YouTube video id — the embed, thumbnail, and dedupe key.
  youtube_video_id text not null unique,
  title text not null,
  -- The YouTube description doubles as show notes.
  show_notes text not null default '',
  thumbnail_url text,
  published_at timestamptz,
  -- 'auto' = pulled by the sync cron; 'manual' = admin-added back-catalog.
  source text not null default 'auto' check (source in ('auto', 'manual')),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists podcast_episodes_published_idx
  on podcast_episodes (published_at desc);

alter table podcast_episodes enable row level security;

-- Members read (hidden rows are filtered in the query; admins manage rows
-- through server actions on the service role, like the other content tables).
drop policy if exists "podcast_episodes: read" on podcast_episodes;
create policy "podcast_episodes: read" on podcast_episodes
  for select using (auth.role() = 'authenticated');

-- Feature registry: Branching Out takes Grow on the Go's slot in the nav
-- ordering. Every tier gets it except Lite (which stays Rooted Focus +
-- Grow on the Go only, per 0054).
insert into app_features (key, label, description, nav_href, sort, is_launched)
values
  ('branching_out', 'Branching Out',
   'The Branching Out podcast — episodes and show notes.',
   '/branching-out', 62, true)
on conflict (key) do nothing;

insert into tier_features (tier_slug, feature_key, allowed)
select t.slug, 'branching_out', t.slug <> 'lite'
from member_tiers t
on conflict (tier_slug, feature_key) do nothing;

-- ============================================================
-- 0074_speaker_contact_email.sql
-- ============================================================
-- Speaker contact email + invite wiring (Matt, 2026-08-05).
--
-- Speakers pulled from TSLS arrive as listings with no Momentum+ account.
-- Their email (from TSLS, or typed by an admin in the editor) is stored
-- here so the admin can later send login invites — one speaker at a time
-- or all at once. Distinct from profiles.email: contact_email is where we
-- REACH the person; profiles.email exists only once they have an account.

alter table speakers add column if not exists contact_email text;

-- Backfill from linked accounts so existing speakers show their email in
-- the admin editor immediately.
update speakers s
set contact_email = p.email
from profiles p
where s.profile_id = p.id
  and s.contact_email is null
  and p.email is not null;

-- ============================================================
-- 0075_scheduled_announcements.sql
-- ============================================================
-- Scheduled announcements (Matt, 2026-08-05): Send Now and Schedule live in
-- the same composer. A scheduled announcement is an announcements row with
-- send_at set and sent_at NULL; the scheduled-posts cron delivers it when
-- due through the same fan-out as Send Now (community, in-app + push,
-- email, SMS), then stamps sent_at. The old scheduled_posts table (chat-only
-- posts) stays for anything already queued, but the admin UI now schedules
-- full announcements instead.

alter table announcements add column if not exists send_at timestamptz;

create index if not exists announcements_due_idx
  on announcements (send_at) where sent_at is null;

-- ============================================================
-- 0076_podcast_seasons.sql
-- ============================================================
-- Podcast seasons (Matt, 2026-08-05): break Branching Out episodes into
-- seasons so members can find them easily. Admin-assigned — per episode in
-- the editor, or in bulk by date range. Episodes without a season appear
-- under "Extras" on the member tab once any season exists.

alter table podcast_episodes add column if not exists season int;

create index if not exists podcast_episodes_season_idx
  on podcast_episodes (season);

-- ============================================================
-- 0077_podcast_engagement.sql
-- ============================================================
-- Branching Out engagement (Matt, 2026-08-05): a green check when a member
-- has listened to an entire episode, private per-member episode notes, and
-- member-submitted questions/challenges/"Leadership Unscripted" prompts to
-- ask guests on the air.

-- One row per member+episode carrying completion + notes (mirrors
-- video_notes: strictly owner-only — no admin read, notes are visible to
-- their author and no one else).
create table if not exists podcast_episode_progress (
  profile_id uuid not null references profiles(id) on delete cascade,
  episode_id uuid not null references podcast_episodes(id) on delete cascade,
  completed boolean not null default false,
  completed_at timestamptz,
  notes text not null default '',
  updated_at timestamptz not null default now(),
  primary key (profile_id, episode_id)
);

alter table podcast_episode_progress enable row level security;

create policy "podcast_episode_progress: owner all"
  on podcast_episode_progress for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- On-air submissions. Members insert and see their own; admins review
-- through the service role (Admin -> Branching Out).
create table if not exists podcast_questions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('question', 'challenge', 'unscripted')),
  body text not null,
  status text not null default 'new' check (status in ('new', 'reviewed', 'asked')),
  created_at timestamptz not null default now()
);

create index if not exists podcast_questions_created_idx
  on podcast_questions (created_at desc);

alter table podcast_questions enable row level security;

create policy "podcast_questions: owner insert"
  on podcast_questions for insert
  with check (profile_id = auth.uid());

create policy "podcast_questions: owner read"
  on podcast_questions for select
  using (profile_id = auth.uid());
