-- Sponsor seasons move to a September 1 clock (Matt, 2026-07-29): every
-- sponsorship is revealed on September 1 and ends September 1 of the
-- following year. This pins every non-archived, term-bearing sponsor to
-- September 1, 2027 (00:00 ET = 04:00 UTC — September is EDT). Prospects
-- (no term yet) pick up the same date when confirmed; ongoing sponsors
-- (expires_at null, e.g. the Host Sponsor) stay ongoing; the archive is
-- untouched. Speakers keep their October 1 cycle.
--
-- HEADS-UP on visibility: the live window runs from expiry minus one year,
-- so a Sept 1, 2027 expiry means the roster is member-visible from
-- September 1, 2026 — sponsors visible today under the old October term go
-- pre-season-hidden until then (Matt confirmed the Sept 1 reveal,
-- 2026-07-29). "Make ongoing" on any sponsor keeps them up continuously.

update public.sponsors
set expires_at = '2027-09-01T04:00:00Z'
where archived_at is null
  and expires_at is not null;

-- Their teams' sponsor-comped access follows the term (same rule as
-- "Make ongoing"/"Set season end"). VIP-ticket comps keep their own
-- 3-month clock.
update public.memberships m
set access_expires_at = '2027-09-01T04:00:00Z'
from public.sponsor_members sm
join public.sponsors s on s.id = sm.sponsor_id
where m.profile_id = sm.profile_id
  and s.archived_at is null
  and s.expires_at = '2027-09-01T04:00:00Z'
  and m.source = 'sponsor'
  and m.status = 'active'
  and m.tier <> 'vip';
