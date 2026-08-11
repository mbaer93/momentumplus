-- ============================================================================
-- Momentum+ migration 0085 — TSLS Speaker Tech Questionnaire (Matt, 2026-08-11)
--
-- The mainstage counterpart to advisor_intake (0084). Mirrors Sierra's live
-- Jotform (form 250896885391071) into Momentum+ so a TSLS Main Speaker
-- answers it where they already log in, and the answers sit on the speaker
-- record rather than in an inbox.
--
-- The two intakes never overlap:
--   tsls_speaker_intake   TSLS Main Speakers — stage, mics, dressing rooms,
--                         call times at The Maryland Theatre.
--   advisor_intake (0084) Leadership Advisors — the virtual featured session
--                         under §6 of the Advisor Agreement.
--
-- WHY answers IS JSONB AND NOT ~50 COLUMNS: the question set is Sierra's,
-- she edits it herself (the Jotform changed twice in July alone), and the
-- authoritative copy lives in lib/tsls-intake.ts. Typed columns would mean a
-- migration every time she adds a checkbox, and a schema that silently drifts
-- from the form it claims to mirror. form_version records which question set
-- produced a given answer map, so an old submission stays readable after the
-- questions move.
--
-- The Jotform keeps its own submissions. Nothing here reads or writes it, and
-- the five responses already collected there are not migrated — see the PR.
--
-- Re-running this file is a no-op.
-- ============================================================================


create table if not exists tsls_speaker_intake (
  id uuid primary key default gen_random_uuid(),
  speaker_id uuid not null unique references speakers (id) on delete cascade,
  profile_id uuid references profiles (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,

  -- Which question set produced this answer map (lib/tsls-intake.ts).
  form_version text not null,
  -- question key -> answer. A checkbox question stores a JSON array.
  answers jsonb not null default '{}'::jsonb,

  -- The form's own signature block, kept out of `answers` because it is the
  -- speaker attesting rather than an answer to a logistics question.
  signed_name text,
  signed_date date
);

comment on table tsls_speaker_intake is
  'TSLS Speaker Tech Questionnaire responses for mainstage Summit speakers, mirroring Sierra''s Jotform (250896885391071). One mutable row per speaker. Distinct from advisor_intake, which covers the virtual Leadership Advisor session.';
comment on column tsls_speaker_intake.answers is
  'question key -> answer, keyed to lib/tsls-intake.ts. Checkbox questions store a JSON array. Answers to questions the speaker was not asked (hidden conditionals) are pruned before saving.';
comment on column tsls_speaker_intake.form_version is
  'TSLS_INTAKE_VERSION at the time of saving — which set of questions this answer map belongs to.';

create index if not exists tsls_speaker_intake_profile_idx
  on tsls_speaker_intake (profile_id);
create index if not exists tsls_speaker_intake_submitted_idx
  on tsls_speaker_intake (submitted_at);


-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function tsls_speaker_intake_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tsls_speaker_intake_set_updated_at on tsls_speaker_intake;
create trigger tsls_speaker_intake_set_updated_at
  before update on tsls_speaker_intake
  for each row execute function tsls_speaker_intake_touch();


-- ---------------------------------------------------------------------------
-- RLS — the speaker and admins can read; only the server writes
--
-- Same posture as 0083 and 0084: no insert/update policy at all, so the
-- server action is the only way in and whose intake it is comes from the
-- session rather than the form body. This one carries emergency contacts and
-- health information, so a stray write policy would be worse here than
-- anywhere else in the schema.
-- ---------------------------------------------------------------------------
alter table tsls_speaker_intake enable row level security;

drop policy if exists "tsls_speaker_intake: read own or admin" on tsls_speaker_intake;
create policy "tsls_speaker_intake: read own or admin"
  on tsls_speaker_intake for select
  using (
    is_admin()
    or exists (
      select 1 from speakers s
      where s.id = tsls_speaker_intake.speaker_id
        and s.profile_id = (select auth.uid())
    )
  );


-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
do $mig$
declare
  probe_speaker uuid;
  probe_row uuid;
  first_touch timestamptz;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.tsls_speaker_intake'::regclass) then
    raise exception '0085: RLS is not enabled on tsls_speaker_intake';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tsls_speaker_intake' and cmd <> 'SELECT'
  ) then
    raise exception '0085: tsls_speaker_intake has a write policy — saving must stay server-side only';
  end if;

  -- One row per speaker is load-bearing: the save path upserts on it.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tsls_speaker_intake'::regclass
      and contype = 'u'
      and conkey = array[
        (select attnum from pg_attribute
          where attrelid = 'public.tsls_speaker_intake'::regclass and attname = 'speaker_id')
      ]::smallint[]
  ) then
    raise exception '0085: tsls_speaker_intake.speaker_id is not unique — upsert-on-save would duplicate rows';
  end if;

  select id into probe_speaker from speakers limit 1;
  if probe_speaker is not null then
    insert into tsls_speaker_intake (speaker_id, form_version, answers)
    values (probe_speaker, '__probe__', '{"name":"__probe__"}'::jsonb)
    returning id, updated_at into probe_row, first_touch;

    update tsls_speaker_intake
      set answers = '{"name":"__probe2__"}'::jsonb
      where id = probe_row;
    if (select updated_at from tsls_speaker_intake where id = probe_row) <= first_touch then
      raise exception '0085: the updated_at trigger did not fire on UPDATE';
    end if;

    delete from tsls_speaker_intake where id = probe_row;
  end if;

  raise notice '0085 verification passed.';
end $mig$;
