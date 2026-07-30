-- ============================================================================
-- 0069: scale hardening for 2,500 concurrent members (capacity review,
-- 2026-07-30). Three independent pieces:
--
-- 1. sponsor_events dedup index — every portal page view runs a dedup check
--    filtered by (profile_id, kind, at); the table only had a sponsor_id
--    index, so that check was a growing sequential scan.
-- 2. auth_user_id_by_email() — replaces paging the whole Auth admin user
--    list (25 API calls per lookup, hard ceiling at 5,000 users) with one
--    indexed query. Security definer; service-role only.
-- 3. profiles.stream_synced_key — marker so Stream channel membership is
--    provisioned once per member per tier-change instead of ~16 Stream API
--    calls on every community page open.
-- ============================================================================

-- 1 ──────────────────────────────────────────────────────────────────────────
create index if not exists sponsor_events_dedupe_idx
  on public.sponsor_events (profile_id, kind, at desc);

-- 2 ──────────────────────────────────────────────────────────────────────────
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.auth_user_id_by_email(text) from public;
revoke all on function public.auth_user_id_by_email(text) from anon;
revoke all on function public.auth_user_id_by_email(text) from authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;

-- 3 ──────────────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists stream_synced_key text;
