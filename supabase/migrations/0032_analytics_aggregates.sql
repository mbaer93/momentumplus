-- Analytics aggregates (Batch G): the admin analytics page used to download
-- raw event rows and count in JS — PostgREST caps responses at 1,000 rows,
-- so busy tables silently under-reported (including sponsor-facing numbers).
-- These views do the counting in the database.

create or replace view public.sponsor_event_counts
  with (security_invoker = true) as
select
  sponsor_id,
  kind,
  count(*)::int as all_count,
  (count(*) filter (where at >= now() - interval '30 days'))::int as recent_count
from public.sponsor_events
group by sponsor_id, kind;

create or replace view public.resource_use_counts
  with (security_invoker = true) as
select
  resource_id,
  count(*)::int as all_count,
  (count(*) filter (where used_at >= now() - interval '30 days'))::int as recent_count
from public.resource_uses
group by resource_id;

create or replace view public.video_view_counts
  with (security_invoker = true) as
select
  video_id,
  count(*)::int as all_count,
  (count(*) filter (where watched_at >= now() - interval '30 days'))::int as recent_count,
  count(distinct profile_id)::int as unique_viewers
from public.video_views
group by video_id;

-- security_invoker: members querying these hit the underlying tables' RLS
-- (which denies them); the service role reads everything. Belt and braces:
revoke select on public.sponsor_event_counts from anon, authenticated;
revoke select on public.resource_use_counts from anon, authenticated;
revoke select on public.video_view_counts from anon, authenticated;
