-- Private per-member notes on Library videos (mirrors session_notes).
-- Strictly owner-only: no admin read — notes are visible to their author
-- and no one else.
create table if not exists video_notes (
  profile_id uuid not null references profiles(id) on delete cascade,
  video_id uuid not null references videos(id) on delete cascade,
  body text not null default '',
  updated_at timestamptz not null default now(),
  primary key (profile_id, video_id)
);

alter table video_notes enable row level security;

create policy "video_notes: owner all"
  on video_notes for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
