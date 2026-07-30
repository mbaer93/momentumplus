-- ============================================================================
-- 0070: backfill season expiries onto bridge-provisioned speaker/sponsor
-- memberships (security audit, 2026-07-30).
--
-- The TSLS bridge ("Open Momentum+" tap by a speaker or sponsor) provisioned
-- source='zapier' memberships with NO expiry — permanent Pro-level access
-- that the Oct 1 speaker clock and Apr 1 sponsor clock could never touch,
-- and that the real onboarding flows couldn't see (they look up their own
-- source values). The code now stamps the season end at grant time; this
-- fixes the rows already minted.
--
-- Dates are this season's boundaries (Oct 1 00:00 ET = 04:00 UTC is always
-- inside daylight time; sponsors confirmed before Oct 1 2026 run through
-- Apr 1 2027 per the April→April rule).
-- ============================================================================

update public.memberships
set access_expires_at = '2026-10-01T04:00:00Z'
where source = 'zapier'
  and tier = 'speaker'
  and access_expires_at is null;

update public.memberships
set access_expires_at = '2027-04-01T04:00:00Z'
where source = 'zapier'
  and tier = 'sponsor'
  and access_expires_at is null;
