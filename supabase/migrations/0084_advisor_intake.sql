-- ============================================================================
-- Momentum+ migration 0084 — Leadership Advisor session intake (Matt, 2026-08-11)
--
-- The companion to the agreement gate (0083). Once an Advisor has signed,
-- this is what SLC still needs from them to actually run their featured
-- month: the session itself, the materials, the tech, the promo assets.
--
-- SCOPE, deliberately: this is NOT the TSLS "Speaker Tech Questionnaire"
-- (the Jotform covering the mainstage — dressing rooms, lapel mics, stage
-- props, the Maryland Theatre). That form stays where it is and keeps its
-- own submissions. This covers the VIRTUAL featured session an Advisor
-- leads under §6, and every question traces to a clause:
--
--   §2   featured month, anticipated session date/time
--   §3   the moderated Advisor panel at the Summit
--   §4   the complimentary VIP Leadership Experience ticket
--   §6   what the session may include (the eight-item list, verbatim)
--   §12  Branching Out with Sierra
--   §21  promotional rights — the assets SLC may use
--   §22  Advisor Materials — the list SLC may request
--   §23  Technology and Session Preparation
--
-- UNLIKE advisor_agreements, this is MUTABLE and one row per Advisor. A
-- signature is a moment; an intake is a working document — §2 lets the month
-- and session date move, and answers should move with them. There is no
-- ledger here and no hash: nothing in this table is a term anyone is bound
-- to.
--
-- Re-running this file is a no-op.
-- ============================================================================


create table if not exists advisor_intake (
  id uuid primary key default gen_random_uuid(),
  -- One row per Advisor. Upserted on save, never duplicated.
  speaker_id uuid not null unique references speakers (id) on delete cascade,
  profile_id uuid references profiles (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set when the Advisor presses Submit with the required answers filled.
  -- Stays set while they keep editing — this records "they handed it in",
  -- not "it is frozen".
  submitted_at timestamptz,

  -- Contact (§22 "Contact information"). Phone lives here rather than on
  -- speakers for the same reason as in 0083: members can select whole
  -- speaker rows, and a phone number is not in §9's community-visible list.
  phone text,
  website text,

  -- The featured session (§2, §6, §22)
  session_title text,
  session_description text,
  session_takeaways text,
  preferred_session_date date,
  preferred_session_time text,
  -- Subset of §6's eight-item list, stored as given.
  session_includes text[] not null default '{}',

  -- Technology and preparation (§23)
  uses_slides boolean,
  slides_format text,
  needs_av boolean,
  can_join_early boolean,
  tech_notes text,

  -- Materials (§22)
  materials_notes text,

  -- Promotion (§10, §21). A map of platform -> handle: the platform list
  -- moves with marketing, and seven nullable columns would need a migration
  -- every time Sierra adds one.
  social_handles jsonb not null default '{}'::jsonb,
  promo_notes text,

  -- Summit participation (§3, §4)
  attending_summit boolean,
  panel_available boolean,
  panel_conflict_notes text,

  -- Podcast (§12)
  podcast_interest boolean,

  additional_notes text
);

comment on table advisor_intake is
  'Leadership Advisor session intake — what SLC needs to run an Advisor''s featured virtual session (§§2, 3, 4, 6, 12, 21, 22, 23). One mutable row per Advisor. Distinct from the TSLS Speaker Tech Questionnaire, which covers the mainstage event and lives in Jotform.';
comment on column advisor_intake.submitted_at is
  'When the Advisor first handed the intake in with the required answers filled. Editing afterwards does not clear it.';
comment on column advisor_intake.session_includes is
  'Subset of the eight-item list in §6 of the Leadership Advisor Agreement, stored verbatim as selected.';
comment on column advisor_intake.social_handles is
  'Platform -> handle map (§21 "Social media handles"). Every entry is optional — Sierra''s note on the TSLS form was that speakers often have nothing to put for some platforms.';

create index if not exists advisor_intake_profile_idx on advisor_intake (profile_id);
create index if not exists advisor_intake_submitted_idx on advisor_intake (submitted_at);


-- ---------------------------------------------------------------------------
-- updated_at maintenance — a working document should say when it last moved
-- ---------------------------------------------------------------------------
create or replace function advisor_intake_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists advisor_intake_set_updated_at on advisor_intake;
create trigger advisor_intake_set_updated_at
  before update on advisor_intake
  for each row execute function advisor_intake_touch();


-- ---------------------------------------------------------------------------
-- RLS — the Advisor and admins can read; only the server writes
--
-- Same shape as advisor_agreements (0083) and for the same reason: saving
-- runs through a server action that resolves WHOSE intake this is from the
-- session, never from the submitted form. With no insert/update policy, a
-- member cannot PATCH another Advisor's answers straight at PostgREST.
-- ---------------------------------------------------------------------------
alter table advisor_intake enable row level security;

drop policy if exists "advisor_intake: read own or admin" on advisor_intake;
create policy "advisor_intake: read own or admin"
  on advisor_intake for select
  using (
    is_admin()
    or exists (
      select 1 from speakers s
      where s.id = advisor_intake.speaker_id
        and s.profile_id = (select auth.uid())
    )
  );


-- ---------------------------------------------------------------------------
-- Verification — fail rather than half-apply
-- ---------------------------------------------------------------------------
do $mig$
declare
  probe_speaker uuid;
  probe_intake uuid;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.advisor_intake'::regclass) then
    raise exception '0084: RLS is not enabled on advisor_intake';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'advisor_intake' and cmd <> 'SELECT'
  ) then
    raise exception '0084: advisor_intake has a write policy — saving must stay server-side only';
  end if;

  -- One row per Advisor is load-bearing (the save path upserts on it).
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.advisor_intake'::regclass
      and contype = 'u'
      and conkey = array[
        (select attnum from pg_attribute
          where attrelid = 'public.advisor_intake'::regclass and attname = 'speaker_id')
      ]::smallint[]
  ) then
    raise exception '0084: advisor_intake.speaker_id is not unique — upsert-on-save would duplicate rows';
  end if;

  -- The updated_at trigger actually fires. Probe against a real speaker so
  -- the FK holds, then clean up.
  --
  -- The probe deliberately does NOT check that updated_at moved forward
  -- against a timestamp read before the UPDATE. now() is
  -- transaction_timestamp() — fixed for the whole transaction — so the trigger
  -- writes back the exact value the INSERT default already stored, and a
  -- "did it advance" test reads as failure however correctly the trigger
  -- behaves. (In production each save is its own transaction, so the trigger
  -- itself is right; only the test was unprovable here.) Instead the UPDATE
  -- supplies a sentinel updated_at and the probe asserts the trigger
  -- overwrote it — the property actually worth proving, and one that holds
  -- inside a single transaction.
  select id into probe_speaker from speakers limit 1;
  if probe_speaker is not null then
    insert into advisor_intake (speaker_id, session_title)
    values (probe_speaker, '__probe__')
    returning id into probe_intake;

    update advisor_intake
      set session_title = '__probe2__',
          updated_at = timestamptz '2000-01-01 00:00:00+00'
      where id = probe_intake;
    if (select updated_at from advisor_intake where id = probe_intake)
         = timestamptz '2000-01-01 00:00:00+00' then
      raise exception '0084: the updated_at trigger did not fire on UPDATE';
    end if;

    delete from advisor_intake where id = probe_intake;
  end if;

  raise notice '0084 verification passed.';
end $mig$;
