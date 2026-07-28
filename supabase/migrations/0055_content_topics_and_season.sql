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
