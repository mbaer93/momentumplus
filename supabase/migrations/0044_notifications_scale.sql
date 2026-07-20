-- ============================================================================
-- Momentum+ migration 0044: notifications at scale (350-member launch)
--
-- 1. (kind, link) index — reminder dedupe, announcement fallback dedupe, and
--    the speaker-notice delivery ledger all look rows up by kind + link; at
--    hundreds of members × daily notifications that lookup needs an index.
-- 2. created_at index — the nightly retention sweep (reconcile cron) deletes
--    old rows by age across all profiles; the existing (profile_id,
--    created_at) index doesn't serve a profile-less age scan.
-- ============================================================================

create index if not exists notifications_kind_link_idx
  on notifications (kind, link);

create index if not exists notifications_created_idx
  on notifications (created_at);
