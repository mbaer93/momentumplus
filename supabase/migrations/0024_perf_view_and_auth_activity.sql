-- Performance support objects (audit batch P).
--
-- 1) session_enrollment_counts: aggregate view so enrollment counts are one
--    query instead of downloading every enrollment row and counting in JS.
--    Service-role only — the aggregate is harmless, but there's no member
--    use case, so least privilege applies.
create or replace view public.session_enrollment_counts
  with (security_invoker = true) as
  select session_id, count(*)::int as enrolled
  from public.enrollments
  group by session_id;

revoke all on public.session_enrollment_counts from public, anon, authenticated;
grant select on public.session_enrollment_counts to service_role;

-- 2) auth_activity: invite/confirm/last-login timestamps for a specific set
--    of profile ids. Replaces paging the entire auth user list (up to 20
--    sequential Auth-admin API calls) on every Admin → Members view.
--    SECURITY DEFINER because auth.users isn't otherwise reachable through
--    PostgREST; execution restricted to the service role.
create or replace function public.auth_activity(ids uuid[])
returns table (
  id uuid,
  invited_at timestamptz,
  confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select u.id, u.invited_at, u.confirmed_at, u.last_sign_in_at, u.created_at
  from auth.users u
  where u.id = any(ids)
$$;

revoke execute on function public.auth_activity(uuid[]) from public, anon, authenticated;
grant execute on function public.auth_activity(uuid[]) to service_role;
