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
