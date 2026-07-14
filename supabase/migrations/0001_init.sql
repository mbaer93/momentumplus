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
