-- Sponsor team roles + self-service Sponsor Studio (Matt, 2026-07-18).
--
-- Every sponsor_members seat now carries a role:
--   owner   — the primary manager (completed the sponsor invite). Holds the
--             sponsorship's one free Momentum+ membership. Cannot be removed;
--             can promote/demote co-managers and transfer ownership.
--   manager — may edit the sponsor page. Only members holding a REGULAR
--             (non-sponsor-comped) membership can be promoted.
--   member  — VIP-ticket holder tied to the sponsor; no edit rights.

alter table sponsor_members
  add column if not exists role text not null default 'member';
alter table sponsor_members
  drop constraint if exists sponsor_members_role_check;
alter table sponsor_members
  add constraint sponsor_members_role_check
  check (role in ('owner', 'manager', 'member'));

-- Existing reps (whoever completed a sponsor invite) own their pages.
update sponsor_members sm
   set role = 'owner'
  from sponsor_invites si
 where si.sponsor_id = sm.sponsor_id
   and si.invited_profile_id = sm.profile_id
   and si.completed_at is not null;

-- Members can see their own seat rows — this is what makes the
-- "Sponsor Studio" nav entry appear for owners/managers.
drop policy if exists "sponsor_members: read own seat" on sponsor_members;
create policy "sponsor_members: read own seat"
  on sponsor_members for select
  using (profile_id = auth.uid());
