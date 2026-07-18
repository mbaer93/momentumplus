-- Legacy tier migration (Matt approved the mapping, 2026-07-18).
-- One-time conversion of pre-July-2026 membership rows to the current
-- member levels. Status and access_expires_at are untouched — only the
-- tier name changes, so nobody gains or loses time.
--
--   sub_annual  -> pro    (annual carried the old VIP-perk access; Pro is
--   tsls_vip    -> pro     today's equivalent, so they keep what they had)
--   sub_monthly -> basic
--   sub_3mo     -> basic
--   sub_6mo     -> basic
--   tsls_attendee -> basic

update memberships set tier = 'pro'
 where tier in ('sub_annual', 'tsls_vip');

update memberships set tier = 'basic'
 where tier in ('sub_monthly', 'sub_3mo', 'sub_6mo', 'tsls_attendee');
