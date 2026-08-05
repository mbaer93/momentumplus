-- Branching Out engagement (Matt, 2026-08-05): a green check when a member
-- has listened to an entire episode, private per-member episode notes, and
-- member-submitted questions/challenges/"Leadership Unscripted" prompts to
-- ask guests on the air.

-- One row per member+episode carrying completion + notes (mirrors
-- video_notes: strictly owner-only — no admin read, notes are visible to
-- their author and no one else).
create table if not exists podcast_episode_progress (
  profile_id uuid not null references profiles(id) on delete cascade,
  episode_id uuid not null references podcast_episodes(id) on delete cascade,
  completed boolean not null default false,
  completed_at timestamptz,
  notes text not null default '',
  updated_at timestamptz not null default now(),
  primary key (profile_id, episode_id)
);

alter table podcast_episode_progress enable row level security;

create policy "podcast_episode_progress: owner all"
  on podcast_episode_progress for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- On-air submissions. Members insert and see their own; admins review
-- through the service role (Admin -> Branching Out).
create table if not exists podcast_questions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('question', 'challenge', 'unscripted')),
  body text not null,
  status text not null default 'new' check (status in ('new', 'reviewed', 'asked')),
  created_at timestamptz not null default now()
);

create index if not exists podcast_questions_created_idx
  on podcast_questions (created_at desc);

alter table podcast_questions enable row level security;

create policy "podcast_questions: owner insert"
  on podcast_questions for insert
  with check (profile_id = auth.uid());

create policy "podcast_questions: owner read"
  on podcast_questions for select
  using (profile_id = auth.uid());
