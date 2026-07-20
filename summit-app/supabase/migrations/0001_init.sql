-- TSLS Summit Companion — its OWN Supabase project, fully separate from
-- Momentum+ (Matt, 2026-07-20: separate Vercel + Supabase; communication
-- with Momentum+ is links only). Attendees arrive through the read-only
-- Google Sheet importer (/api/import/tsls), which invites them by email;
-- there is no self-serve signup.

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user, auto-created on signup/invite
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

create policy profiles_own_read on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- Members may fix their own display name — nothing else. is_admin is
-- protected by the column grant, not just the row policy.
revoke update on table public.profiles from authenticated;
grant update (full_name) on table public.profiles to authenticated;

create policy profiles_own_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No directory read policy on purpose: the community DM directory is served
-- by a service-role API route, so emails/flags never leak via client reads.

-- ---------------------------------------------------------------------------
-- attendees — the ticket ledger, filled by the read-only Sheet importer.
-- One row per email per event year (idempotency; mirrors the Sheet).
-- ---------------------------------------------------------------------------
create table public.attendees (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles (id) on delete set null,
  email text not null,
  name text,
  registration_type text,
  event_year int not null,
  source text not null default 'sheet_import',
  registered_at timestamptz not null default now(),
  unique (email, event_year)
);

alter table public.attendees enable row level security;

-- Attendees read their own ticket; the importer writes via service role.
create policy attendees_own_read on public.attendees
  for select to authenticated
  using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- event_speakers — the event lineup, managed in /admin (not synced from
-- anywhere; the summit curates its own speakers)
-- ---------------------------------------------------------------------------
create table public.event_speakers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text,
  bio text,
  headshot_url text,
  website text,
  tags text,                       -- comma-separated topic tags
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.event_speakers enable row level security;

create policy event_speakers_member_read on public.event_speakers
  for select to authenticated
  using (active = true);

-- ---------------------------------------------------------------------------
-- agenda_items — the day-of schedule
-- ---------------------------------------------------------------------------
create table public.agenda_items (
  id uuid primary key default gen_random_uuid(),
  event_year int not null,
  title text not null,
  description text,
  kind text not null default 'session'
    check (kind in ('keynote', 'session', 'workshop', 'panel', 'break',
                    'meal', 'networking', 'registration', 'other')),
  location text,
  track text,
  speaker_id uuid references public.event_speakers (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  vip_only boolean not null default false,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

create index agenda_items_year_start_idx
  on public.agenda_items (event_year, starts_at);

alter table public.agenda_items enable row level security;

create policy agenda_member_read on public.agenda_items
  for select to authenticated
  using (published = true);

-- ---------------------------------------------------------------------------
-- vendors — exhibitors with booths
-- ---------------------------------------------------------------------------
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  event_year int not null,
  name text not null,
  tagline text,
  description text,
  category text,
  booth text,
  website text,
  logo_url text,
  offer text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index vendors_year_sort_idx
  on public.vendors (event_year, sort_order);

alter table public.vendors enable row level security;

create policy vendors_member_read on public.vendors
  for select to authenticated
  using (active = true);

-- ---------------------------------------------------------------------------
-- app_settings — event settings ("summit" key). Service-role only; no
-- client policies on purpose.
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
