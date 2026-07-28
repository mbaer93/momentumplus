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
