-- Education: curated courses (learning tracks) built from library videos,
-- with per-member lesson completion. Mirrors the videos/resources RLS model:
-- members read published content at/below their access level; writes are
-- admin-only; progress rows belong to the member.

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text,
  min_access access_level not null default 'all_members',
  position int not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists course_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  video_id uuid references videos(id) on delete set null,
  title text not null,
  summary text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists course_lessons_course_idx
  on course_lessons (course_id, position);

create table if not exists lesson_progress (
  profile_id uuid not null references profiles(id) on delete cascade,
  lesson_id uuid not null references course_lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (profile_id, lesson_id)
);

alter table courses enable row level security;
alter table course_lessons enable row level security;
alter table lesson_progress enable row level security;

create policy "courses: read published visible"
  on courses for select
  using (
    is_admin()
    or (published_at is not null and can_view(min_access))
  );

create policy "courses: admin write"
  on courses for all
  using (is_admin())
  with check (is_admin());

create policy "course_lessons: read via course"
  on course_lessons for select
  using (
    exists (
      select 1 from courses c
      where c.id = course_id
        and (
          is_admin()
          or (c.published_at is not null and can_view(c.min_access))
        )
    )
  );

create policy "course_lessons: admin write"
  on course_lessons for all
  using (is_admin())
  with check (is_admin());

create policy "lesson_progress: read own or admin"
  on lesson_progress for select
  using (profile_id = auth.uid() or is_admin());

create policy "lesson_progress: insert own"
  on lesson_progress for insert
  with check (profile_id = auth.uid());

create policy "lesson_progress: delete own"
  on lesson_progress for delete
  using (profile_id = auth.uid());
