-- Earned badges, written down (Matt, 2026-08-19: "I want to track this in a
-- way that we can offer special deals to people who hold specific badges").
--
-- Until now a badge was computed at render time from live counts and stored
-- nowhere. That is fine for decoration on a profile and useless the moment
-- money is attached to it:
--
--   * There is no row to query, so "everyone holding Founding Member" cannot
--     be selected as an announcement audience, tagged in GHL, or counted.
--   * There is no earned-on date, so an offer cannot key off "just earned"
--     and a member cannot be told how long they have held something.
--   * Badges could go BACKWARDS. Archive a course or a session and the
--     underlying count drops, silently withdrawing a badge you may already
--     have promised a deal for.
--
-- So: a ledger. One row per member per badge, stamped when first earned,
-- and never deleted by the sync — Matt's rule is "earned is earned". The
-- sync only ever INSERTs. Removing a badge is a deliberate admin act, not
-- something a content change can do by accident.

create table if not exists member_badges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  -- Keys come from lib/badges.ts: a track tier ("attendance:2"), a
  -- milestone ("founding"), or an overall level ("level:committed").
  -- Deliberately text, not an enum: badge definitions are product copy and
  -- change faster than migrations should.
  badge_key text not null,
  earned_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- One row per badge per member; the sync relies on this to be idempotent.
create unique index if not exists member_badges_unique
  on member_badges (profile_id, badge_key);

-- "Who holds X?" — the audience query. Leads with badge_key because that is
-- the side being filtered.
create index if not exists member_badges_key_idx
  on member_badges (badge_key, profile_id);

comment on table member_badges is
  'Earned badges, append-only. Written by the badges cron; never removed by it. Powers badge-targeted announcements, GHL tags, and offers.';

alter table member_badges enable row level security;

-- A member reads their own. Everything else — the directory strip, audience
-- selection, tag sync — runs through the service role, the same as the
-- counting in lib/badge-queries.ts, because a badge is an aggregate about
-- someone else and member-to-member profile reads are denied by design.
drop policy if exists "member_badges own read" on member_badges;
create policy "member_badges own read" on member_badges
  for select using (auth.uid() = profile_id);

-- No member-writable policy of any kind. Badges are earned, not claimed.

-- Announcements can target badge holders, alongside (or instead of) tiers.
-- Empty array = no badge filter, which keeps every existing row behaving
-- exactly as it does today.
alter table announcements
  add column if not exists audience_badges text[] not null default '{}';

comment on column announcements.audience_badges is
  'Badge keys this announcement targets. Combined with audience_tiers as a UNION: a member matching either is in the audience.';
