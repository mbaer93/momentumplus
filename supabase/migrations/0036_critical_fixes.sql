-- Critical fixes from the triple audit (Matt, 2026-07-18).

-- 1. Speaker memberships were impossible: the enum never had 'speaker', so
--    speaker onboarding / archive / reinstate membership writes all failed
--    (and the errors were ignored — fixed app-side in the same batch).
alter type membership_source add value if not exists 'speaker';

-- 2. Members could not see cancelled sessions AT ALL (the read policy
--    predates the cancelled status), so cancelling a session 404'd it for
--    members instead of showing the honest "Cancelled" state built for it.
drop policy if exists "sessions: read visible" on sessions;
create policy "sessions: read visible"
  on sessions for select
  using (
    is_admin()
    or (
      status in ('scheduled', 'live', 'completed', 'archived', 'cancelled')
      and can_view(min_access)
    )
  );

-- 3. Heal recurring (Rooted Focus) sessions the status cron already flipped
--    to completed after their first occurrence — the cron is now
--    recurrence-aware and keeps series in scheduled/live until the series
--    actually ends.
update sessions
   set status = 'scheduled'
 where recurrence is not null
   and status = 'completed'
   and (recurrence_until is null or recurrence_until > now());
