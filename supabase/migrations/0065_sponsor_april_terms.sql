-- Correction to 0064 (Matt, 2026-07-29): the sponsor lifecycle is APRIL 1
-- to April 1, not September 1. Every current sponsor belongs to the season
-- already in progress (April 1, 2026 – April 1, 2027), so they are all
-- member-visible NOW and come down April 1, 2027 (00:00 ET = 04:00 UTC —
-- April is EDT). This re-pins every non-archived, term-bearing sponsor,
-- whether 0064 ran before it or not. Ongoing sponsors (expires_at null,
-- e.g. the Host Sponsor) stay ongoing; the archive is untouched. Speakers
-- keep their October 1 cycle.

update public.sponsors
set expires_at = '2027-04-01T04:00:00Z'
where archived_at is null
  and expires_at is not null;

-- Their teams' sponsor-comped access follows the term (same rule as
-- "Make ongoing"/"Set season end"). VIP-ticket comps keep their own
-- 3-month clock.
update public.memberships m
set access_expires_at = '2027-04-01T04:00:00Z'
from public.sponsor_members sm
join public.sponsors s on s.id = sm.sponsor_id
where m.profile_id = sm.profile_id
  and s.archived_at is null
  and s.expires_at = '2027-04-01T04:00:00Z'
  and m.source = 'sponsor'
  and m.status = 'active'
  and m.tier <> 'vip';
