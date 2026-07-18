-- Batch J: sponsor-tier gating + announcement correctness.
-- Requires 0037 (adds the 'sponsor' enum value) to have run FIRST, in its
-- own SQL-editor run.

-- 1. Sponsor tier is Pro-equivalent: it clears both the vip_plus and
--    pro_only gates, exactly like the access the reps held as comped Pro.
create or replace function can_view(required access_level)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when is_admin() then true
    when required = 'admin_only' then false
    when required = 'all_members' then
      exists (
        select 1 from memberships m
        where m.profile_id = auth.uid()
          and membership_grants_access(m.status, m.access_expires_at)
      )
    when required = 'vip_plus' then
      (current_user_tiers() && array['tsls_vip','sub_annual','speaker','admin','pro','sponsor']::access_tier[])
    when required = 'pro_only' then
      (current_user_tiers() && array['pro','admin','sponsor']::access_tier[])
    else false
  end;
$$;

-- 2. Existing sponsor reps (completed a sponsor invite) move from their
--    comped Pro row to the sponsor tier. Seat members a sponsor comps keep
--    Pro — the tier marks who RUNS a sponsor page.
update memberships m
   set tier = 'sponsor'
  from sponsor_invites si
 where si.invited_profile_id = m.profile_id
   and si.completed_at is not null
   and m.source = 'sponsor'
   and m.tier = 'pro';

-- 3. Journal the community (#announcements) post per announcement, so
--    retrying a partially-failed send can't post the same message to chat
--    twice.
alter table announcements
  add column if not exists community_posted_at timestamptz;
