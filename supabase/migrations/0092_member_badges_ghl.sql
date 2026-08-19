-- Badge → GHL contact tag sync (Matt, 2026-08-19: badges should drive offers,
-- and offers are built in GHL).
--
-- Why a journal column rather than "tag whatever was just awarded": the
-- badge row is written first and is permanent. If the GHL call then fails —
-- rate limit, expired key, network — the badge is no longer "newly earned"
-- on the next run, so the tag would be lost forever and the member would
-- quietly miss every offer built on it.
--
-- Null = not yet pushed. The sync claims null rows, tags them, and stamps
-- the time; a failure simply leaves the row null for the next run to retry.
-- Nothing here is on a member-facing path, so retrying forever is free.

alter table member_badges
  add column if not exists ghl_synced_at timestamptz;

comment on column member_badges.ghl_synced_at is
  'When this badge was pushed to GHL as a contact tag. Null = still owed. Cleared by hand to force a re-push.';

-- The sync''s only query: "what is still owed?". Partial, because the
-- answer is almost always a handful of rows against a table that grows
-- forever.
create index if not exists member_badges_unsynced_idx
  on member_badges (profile_id) where ghl_synced_at is null;
