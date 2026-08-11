-- ============================================================================
-- 0087 — More than one speaker per session (Matt, 2026-08-12)
--
-- sessions.speaker_id holds a single speaker, so a panel or a co-taught
-- session could only ever name one presenter. This adds an ordered join
-- table and backfills it from the column.
--
-- sessions.speaker_id is KEPT and stays pointed at the first listed speaker.
-- It is no longer the source of truth — session_speakers is — but leaving it
-- in place means any read path not yet migrated still shows a real speaker
-- instead of nothing, and the existing on-delete-set-null behaviour is
-- undisturbed. The admin save path writes both.
--
-- Speakers are equals here, not lead-and-support (Matt's call): `sort` is
-- billing order only, and every listed speaker gets identical rights.
-- ============================================================================

create table if not exists session_speakers (
  session_id uuid not null references sessions (id) on delete cascade,
  speaker_id uuid not null references speakers (id) on delete cascade,
  -- Display order. Ties break on speaker_id so the order is at least stable.
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  primary key (session_id, speaker_id)
);

-- The hot lookup is "which sessions does this speaker present?" — Speaker
-- Studio runs it on every page load to decide what they may touch.
create index if not exists session_speakers_speaker_idx
  on session_speakers (speaker_id);

comment on table session_speakers is
  'Ordered speaker lineup for a session. Source of truth for who presents; sessions.speaker_id mirrors the first row for legacy read paths. Every listed speaker has equal rights in Speaker Studio.';

-- Backfill: every session that already names a speaker keeps it, first in
-- the order. Idempotent, so re-running the migration is safe.
insert into session_speakers (session_id, speaker_id, sort)
select s.id, s.speaker_id, 0
from sessions s
where s.speaker_id is not null
on conflict (session_id, speaker_id) do nothing;

alter table session_speakers enable row level security;

-- Who presents a session is as public as the session itself: if the reader
-- can see the session, they can see its lineup. Deliberately expressed as a
-- subquery against sessions rather than re-stating the visibility rules,
-- so a restricted (invite-only) session's lineup stays hidden along with it
-- and this policy can never drift from 0059's.
drop policy if exists "session_speakers: read with session" on session_speakers;
create policy "session_speakers: read with session" on session_speakers
  for select using (
    exists (
      select 1 from sessions s where s.id = session_speakers.session_id
    )
  );

drop policy if exists "session_speakers: admin write" on session_speakers;
create policy "session_speakers: admin write" on session_speakers
  for all using (is_admin()) with check (is_admin());

-- Verification. A backfill that silently moved nothing looks identical to a
-- successful one, so assert it actually covered every speakered session.
do $$
declare
  missing integer;
begin
  select count(*) into missing
  from sessions s
  where s.speaker_id is not null
    and not exists (
      select 1 from session_speakers ss
      where ss.session_id = s.id and ss.speaker_id = s.speaker_id
    );
  if missing > 0 then
    raise exception 'Backfill missed % session(s) with a speaker_id', missing;
  end if;
end $$;
