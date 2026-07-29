-- ============================================================================
-- Momentum+ migration 0059: invite-only sessions (Matt, 2026-07-29).
--
-- "When creating a new A2A session I want to be able to select all, or
--  specific members … No one else should be aware of the session unless
--  they are specifically selected."
--
-- sessions.restricted + a session_invitees roster. The read policy is the
-- enforcement: a restricted session simply does not exist for anyone who
-- isn't on its roster (or an admin) — no list, no calendar entry, no
-- detail page, no 404-vs-403 tell. Built for Aspire2Achieve but nothing
-- here is A2A-specific.
-- ============================================================================

alter table sessions add column if not exists restricted boolean not null default false;

create table if not exists session_invitees (
  session_id uuid not null references sessions (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, profile_id)
);

create index if not exists session_invitees_profile_idx
  on session_invitees (profile_id);

alter table session_invitees enable row level security;

-- A member may see their own invitations (that's what lets the session
-- itself through the policy below); the full roster is admin-only.
drop policy if exists "session_invitees: read own" on session_invitees;
create policy "session_invitees: read own" on session_invitees
  for select using (is_admin() or profile_id = auth.uid());

drop policy if exists "session_invitees: admin write" on session_invitees;
create policy "session_invitees: admin write" on session_invitees
  for all using (is_admin()) with check (is_admin());

-- Same policy as 0036, plus the roster check for restricted rows.
drop policy if exists "sessions: read visible" on sessions;
create policy "sessions: read visible"
  on sessions for select
  using (
    is_admin()
    or (
      status in ('scheduled', 'live', 'completed', 'archived', 'cancelled')
      and can_view(min_access)
      and (
        not restricted
        or exists (
          select 1 from session_invitees i
          where i.session_id = sessions.id
            and i.profile_id = auth.uid()
        )
      )
    )
  );
