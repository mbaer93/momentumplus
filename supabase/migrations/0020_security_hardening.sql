-- Security hardening (audit batch B).
--
-- 1. Quiz answers must not be readable by members at the DB boundary.
--    The app strips them (publicQuiz), but the `quiz` jsonb (with answer
--    indexes) was selectable via PostgREST with any member JWT. Column-level
--    grants: members can read every lesson column EXCEPT quiz; the server
--    reads quiz via the service role.
revoke select on table public.course_lessons from anon, authenticated;
grant select (id, course_id, video_id, title, summary, position, created_at,
              content, image_url, documents)
  on public.course_lessons to anon, authenticated;

-- 2. Lesson completion rows could be inserted directly for ANY lesson —
--    including quiz lessons (skipping the test) and lessons of unpublished
--    or tier-gated courses — minting fraudulent CE certificates. The insert
--    policy now allows only test-free lessons of published, visible courses;
--    quiz lessons complete exclusively through the server-graded action
--    (service role). SECURITY DEFINER so the check itself can read the
--    now-hidden quiz column.
create or replace function public.lesson_completable_by_member(lesson uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from course_lessons cl
    join courses c on c.id = cl.course_id
    where cl.id = lesson
      and (cl.quiz is null
           or jsonb_array_length(coalesce(cl.quiz->'questions', '[]'::jsonb)) = 0)
      and c.published_at is not null
      and can_view(c.min_access)
  );
$$;

drop policy if exists "lesson_progress: insert own" on public.lesson_progress;
create policy "lesson_progress: insert own completable" on public.lesson_progress
  for insert with check (
    profile_id = auth.uid()
    and lesson_completable_by_member(lesson_id)
  );

-- 3. Zoom join link (and passcode) are for enrolled members only. The row
--    was member-readable whole, so the "enrolled-only" join link was
--    cosmetic. Members can read the schedule columns; join credentials are
--    handed out server-side after the enrollment check.
revoke select on table public.sessions from anon, authenticated;
grant select (id, title, description, speaker_id, category, starts_at,
              duration_min, capacity, min_access, status, created_at)
  on public.sessions to anon, authenticated;

-- 4. Sponsor impression/click stats could be inserted by ANYONE holding the
--    public anon key (profile_id null satisfied the check). Authenticated
--    members only.
drop policy if exists "sponsor_events: insert self or anon-null" on public.sponsor_events;
create policy "sponsor_events: insert authenticated" on public.sponsor_events
  for insert to authenticated
  with check (profile_id is null or profile_id = auth.uid());

-- 5. Lesson documents/images for gated courses lived in a PUBLIC bucket —
--    permanent unauthenticated URLs. Private from now on; the app serves
--    short-lived signed URLs after the RLS-gated course fetch.
update storage.buckets set public = false where id = 'education-media';
