-- Testers: real accounts, real tiers, invisible to real members.
--
-- Matt, 2026-08-14: before the Oct 14 launch he needs several people inside
-- the app behaving exactly as members will — full tier access, every email
-- and notification, nothing simulated — without those accounts appearing in
-- the directory, the chat roster, or any member-facing count.
--
-- A FLAG, not a tier. A tester tier would have to be granted access feature
-- by feature and would drift from the real ones the moment the grid changed;
-- the whole point is that a tester's experience is a real tier's experience.

alter table profiles
  add column if not exists tester boolean not null default false;

-- Who marked them and when, so "why is this person hidden?" has an answer.
alter table profiles
  add column if not exists tester_since timestamptz;

comment on column profiles.tester is
  'Test account. Full tier access; hidden from every member-facing list. Admins see them flagged.';

-- Every member-facing listing filters on this column, so it earns an index
-- even though the row count is small.
create index if not exists profiles_tester_idx on profiles (tester) where tester;

/*
 * Directory reads run through the service role (profiles RLS already denies
 * member-to-member reads), so the hiding is enforced in lib/testers.ts —
 * see visibleToMembers(). This column is the single source of truth both
 * paths read.
 */
