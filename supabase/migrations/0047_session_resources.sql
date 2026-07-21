-- ============================================================================
-- Momentum+ migration 0047: per-session resources (SPEC.md §4 — the session
-- page and live-room drawer have always had a Resources tab; this gives it
-- data). Admins attach resources on the session editor; speakers attach them
-- to their own sessions from Speaker Studio. All writes go through server
-- actions (service role); members READ resources of any session they can see
-- (the subquery runs under the member's own sessions RLS).
-- ============================================================================

create table session_resources (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  name text not null,
  type text, -- short label shown under the name, e.g. "PDF", "Link", "Slides"
  url text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create index session_resources_session_idx
  on session_resources (session_id, sort, created_at);

alter table session_resources enable row level security;

create policy "session resources: member read"
  on session_resources for select
  using (
    exists (select 1 from sessions s where s.id = session_id)
  );
