-- Community message counts, pulled from Stream (Matt, 2026-08-19).
--
-- The "In the Conversation" badge track has been unearnable since it was
-- written: messages live in Stream, not in this database, so the count was
-- null — deliberately null and not zero, because zero would have said "0
-- messages" to someone who posts every day. This table is where the pull
-- lands, and the track becomes real.
--
-- A CACHE, not a ledger. Stream owns the truth; this is last night's tally,
-- rewritten each run. Nothing depends on it being current to the minute —
-- and because badges are append-only (0091), a count that dips when someone
-- deletes a message can never take an earned badge away.

create table if not exists community_message_counts (
  profile_id uuid primary key references profiles (id) on delete cascade,
  messages integer not null default 0,
  counted_at timestamptz not null default now()
);

comment on table community_message_counts is
  'Per-member community message totals pulled from Stream by the badges cron. A cache of Stream, rewritten each run.';

alter table community_message_counts enable row level security;

-- Read paths are service-role (the same as every other badge count — an
-- aggregate about someone else, which member-to-member profile reads deny).
-- A member may see their own, so "12 messages" on their profile has a
-- source they could check.
drop policy if exists "own message count" on community_message_counts;
create policy "own message count" on community_message_counts
  for select using (auth.uid() = profile_id);
