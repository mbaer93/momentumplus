-- TSLS Summit companion (Matt, 2026-07-20): the in-person event experience —
-- agenda, vendors, and each attendee's own ticket record — layered on top of
-- the existing portal. Event settings (name, dates, venue, registration and
-- upgrade links) live in app_settings under the "summit" key.

-- ---------------------------------------------------------------------------
-- agenda_items — the day-of schedule (keynotes, sessions, breaks, meals)
-- ---------------------------------------------------------------------------
create table if not exists public.agenda_items (
  id uuid primary key default gen_random_uuid(),
  event_year int not null,
  title text not null,
  description text,
  -- What kind of block this is; drives the icon/badge on the agenda timeline.
  kind text not null default 'session'
    check (kind in ('keynote', 'session', 'workshop', 'panel', 'break',
                    'meal', 'networking', 'registration', 'other')),
  location text,                  -- room / area inside the venue
  track text,                     -- optional track label (e.g. Marketing)
  speaker_id uuid references public.speakers (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  -- VIP Leadership Experience blocks (still listed for everyone, badged VIP).
  vip_only boolean not null default false,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists agenda_items_year_start_idx
  on public.agenda_items (event_year, starts_at);

alter table public.agenda_items enable row level security;

-- Members read published items; all writes go through the service role.
drop policy if exists agenda_member_read on public.agenda_items;
create policy agenda_member_read on public.agenda_items
  for select to authenticated
  using (published = true or is_admin());

-- ---------------------------------------------------------------------------
-- vendors — exhibitors with booths at the in-person event
-- ---------------------------------------------------------------------------
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  event_year int not null,
  name text not null,
  tagline text,
  description text,
  category text,
  booth text,                     -- booth/table label, e.g. "Lobby 4"
  website text,
  logo_url text,
  offer text,                     -- attendee-only special, shown on the card
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists vendors_year_sort_idx
  on public.vendors (event_year, sort_order);

alter table public.vendors enable row level security;

drop policy if exists vendors_member_read on public.vendors;
create policy vendors_member_read on public.vendors
  for select to authenticated
  using (active = true or is_admin());

-- ---------------------------------------------------------------------------
-- import_log — attendees may read their own registration row. This is what
-- powers "My Ticket": the Sheets import already records email, event year,
-- and registration type per attendee, so the ticket page reads that ledger
-- instead of adding a second registration pipeline.
-- ---------------------------------------------------------------------------
drop policy if exists import_log_own_read on public.import_log;
create policy import_log_own_read on public.import_log
  for select to authenticated
  using (profile_id = auth.uid());
