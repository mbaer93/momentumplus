-- ============================================================================
-- 0071: RLS + rate-limit hardening (security verification sweep, 2026-07-30).
--
-- Three findings from the full RLS/abuse audit:
--
-- 1. sponsor_events allowed authenticated INSERT (0020) even though the only
--    legitimate writer — /api/sponsors/track — inserts through the service
--    role after per-member dedup. The policy let a member bypass that dedup
--    entirely with direct PostgREST inserts and inflate any sponsor's
--    impression/click stats. Sponsor-facing numbers must be trustworthy, so
--    the member-facing write path is closed; the service role is unaffected.
--
-- 2. The videos read policy (0055) checked published/tier/season but never
--    archived_at (0028) — archived library items stayed directly readable
--    via PostgREST even though every app query hides them.
--
-- 3. action_events: a tiny durable ledger for rate limiting. The help-chat
--    limiter lived in a per-process Map, which resets on every cold start
--    and doesn't hold across serverless instances — so the "20 AI calls per
--    hour" cap was advisory. Service-role only; lib/throttle.ts is the API.
-- ============================================================================

-- 1. sponsor_events: service-role writes only.
drop policy if exists "sponsor_events: insert authenticated" on public.sponsor_events;
revoke insert on public.sponsor_events from authenticated;

-- 2. Archived videos disappear from direct reads too.
drop policy if exists "videos: read published visible" on videos;
create policy "videos: read published visible"
  on videos for select
  using (
    is_admin()
    or (
      published_at is not null
      and archived_at is null
      and can_view(min_access)
      and library_season_ok(coalesce(season, season_of(published_at)))
    )
  );

-- 3. Durable action ledger for rate limits (help chat, speaker questions).
create table if not exists action_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);

create index if not exists action_events_lookup_idx
  on action_events (profile_id, action, created_at desc);

alter table action_events enable row level security;
-- No policies: service-role only, like the other ledgers.
