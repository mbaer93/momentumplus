-- Batch C data integrity.

-- 1. Session capacity was collected in the admin form but enforced nowhere —
--    a 20-seat mastermind accepted unlimited enrollments. DB trigger is the
--    backstop (the enroll action also checks first for a friendly message).
create or replace function public.enforce_session_capacity()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  cap integer;
  taken integer;
begin
  select capacity into cap from sessions where id = new.session_id;
  if cap is not null and cap > 0 then
    select count(*) into taken from enrollments where session_id = new.session_id;
    if taken >= cap then
      raise exception 'Session is full';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enrollments_capacity on public.enrollments;
create trigger enrollments_capacity
  before insert on public.enrollments
  for each row execute function public.enforce_session_capacity();

-- 2. Repeat visits inflated the learning record: one view row per page
--    exit with no uniqueness. Dedupe (keep the earliest view) and constrain.
with ranked as (
  select id, row_number() over (
    partition by profile_id, video_id order by created_at asc
  ) as rn
  from public.video_views
)
delete from public.video_views v using ranked r
where v.id = r.id and r.rn > 1;

create unique index if not exists video_views_profile_video_key
  on public.video_views (profile_id, video_id);
