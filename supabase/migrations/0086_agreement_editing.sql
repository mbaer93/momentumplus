-- ============================================================================
-- Momentum+ migration 0086 — an editable Leadership Advisor Agreement
-- (Matt, 2026-08-11: "I don't want a completed agreement to be editable, I
--  want to be able to edit the agreement before it is sent to the speaker.")
--
-- Until now the agreement was a code constant (lib/advisor-agreement.ts).
-- Two tables make it editable without ever putting a signed copy at risk:
--
--   agreement_templates   Versions of the MASTER document. One draft at a
--                         time; publishing freezes that draft and makes it
--                         what new signers see.
--   agreement_overrides   Per-speaker clause overrides, so one Advisor's
--                         copy can differ before it goes to them.
--
-- WHAT PROTECTS A SIGNED COPY. Nothing here touches advisor_agreements
-- (0083), which is append-only and carries its own immutability trigger.
-- A signature stores the SHA-256 of the exact text rendered at signing, so
-- editing a template afterwards cannot retroactively change what anyone
-- agreed to — the old hash still describes the old words.
--
-- WHY A TIMESTAMP DECIDES RE-SIGNATURE, NOT A VERSION STRING. §32 needs both
-- parties to agree to a MATERIAL amendment, and the platform cannot tell a
-- typo fix from a change of terms — so the admin says which it is when they
-- publish. `requires_resignature` stamps `material_changed_at`, and a
-- signature is current when it was made at or after the most recent material
-- change that applies to that speaker. Cosmetic edits leave signatures alone.
--
-- Re-running this file is a no-op.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. agreement_templates — versions of the master document
-- ---------------------------------------------------------------------------
create table if not exists agreement_templates (
  id uuid primary key default gen_random_uuid(),

  -- Human-facing label for the wording ("2026-08-11"). Unique so two
  -- publishes can never claim to be the same terms.
  version text not null unique,

  title text not null,
  preamble text not null,
  acceptance text not null,
  -- [{ n, title, blocks: [{kind, text} | {kind:'ul', items:[]}] }] — the
  -- same shape lib/advisor-agreement.ts describes. Sections are reworded in
  -- place; numbering is stable because §6 and §14 are referenced by number
  -- elsewhere in the app (the intake checklist, the earnings split).
  sections jsonb not null,

  -- SHA-256 of the canonical rendering of THIS master text. Lets an admin
  -- see that two versions really do differ, without diffing prose.
  sha256 text not null,

  status text not null default 'draft'
    check (status in ('draft', 'published')),

  -- Set at publish: did this change need everyone to sign again?
  requires_resignature boolean not null default false,
  -- Stamped at publish when requires_resignature — the moment older
  -- signatures stopped counting.
  material_changed_at timestamptz,

  created_at timestamptz not null default now(),
  published_at timestamptz,
  created_by uuid references profiles (id) on delete set null
);

comment on table agreement_templates is
  'Versions of the master Momentum+ Leadership Advisor Agreement. At most one draft exists at a time; published rows are the wording Advisors sign. Editing a row here never alters a signature — advisor_agreements stores the hash of the text as rendered at signing.';
comment on column agreement_templates.requires_resignature is
  'Set by the admin at publish. True = a material amendment (§32): every signature older than material_changed_at stops counting and those Advisors are asked to sign again. False = a cosmetic edit that leaves signatures alone.';

-- At most one draft, ever. A second in-flight draft would make "the thing I
-- am editing" ambiguous between two admins.
create unique index if not exists agreement_templates_one_draft
  on agreement_templates ((status)) where status = 'draft';

create index if not exists agreement_templates_published_idx
  on agreement_templates (published_at desc) where status = 'published';


-- ---------------------------------------------------------------------------
-- 2. agreement_overrides — one Advisor's copy differing from the master
-- ---------------------------------------------------------------------------
create table if not exists agreement_overrides (
  id uuid primary key default gen_random_uuid(),
  speaker_id uuid not null unique references speakers (id) on delete cascade,

  -- { "<section number>": { "title": "...", "blocks": [...] } } — only the
  -- sections that differ. Everything absent falls through to the master, so
  -- a master edit still reaches an overridden Advisor everywhere they have
  -- not been given bespoke wording.
  sections jsonb not null default '{}'::jsonb,

  note text,

  -- Same rule as the master: an override that changes terms materially
  -- stamps this, and a signature older than it no longer counts.
  material_changed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id) on delete set null
);

comment on table agreement_overrides is
  'Per-speaker clause overrides on the master Leadership Advisor Agreement. Sparse: only the sections that differ are stored, so master edits still reach an overridden Advisor everywhere else.';

create index if not exists agreement_overrides_speaker_idx
  on agreement_overrides (speaker_id);

create or replace function agreement_overrides_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists agreement_overrides_set_updated_at on agreement_overrides;
create trigger agreement_overrides_set_updated_at
  before update on agreement_overrides
  for each row execute function agreement_overrides_touch();


-- ---------------------------------------------------------------------------
-- 3. Published templates are frozen
--
-- A draft is meant to be edited; a published version is what somebody
-- signed against, so its words must not move afterwards. Editing published
-- wording is a NEW version, which is the whole point of keeping versions.
-- Only the lifecycle columns may change (nothing does today, but a future
-- "retire this version" must not require dropping the trigger).
-- ---------------------------------------------------------------------------
create or replace function agreement_templates_published_frozen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'published' and (
       new.title <> old.title
    or new.preamble <> old.preamble
    or new.acceptance <> old.acceptance
    or new.sections is distinct from old.sections
    or new.version <> old.version
    or new.sha256 <> old.sha256
  ) then
    raise exception
      'agreement_templates: published wording is immutable — publish a new version instead of editing % .', old.version;
  end if;
  return new;
end;
$$;

drop trigger if exists agreement_templates_no_edit_published on agreement_templates;
create trigger agreement_templates_no_edit_published
  before update on agreement_templates
  for each row execute function agreement_templates_published_frozen();


-- ---------------------------------------------------------------------------
-- 4. RLS — Advisors may read what they are asked to sign; only the server writes
--
-- Published templates are readable by any signed-in member: an Advisor has
-- to be able to read the agreement, and it is not secret. Drafts are
-- admin-only — unpublished wording is not an offer to anybody. Overrides
-- are readable by the speaker they belong to and by admins.
--
-- No insert/update/delete policy anywhere: every write goes through a server
-- action that has already checked the caller is an admin.
-- ---------------------------------------------------------------------------
alter table agreement_templates enable row level security;
alter table agreement_overrides enable row level security;

drop policy if exists "agreement_templates: published or admin" on agreement_templates;
create policy "agreement_templates: published or admin"
  on agreement_templates for select
  using (is_admin() or status = 'published');

drop policy if exists "agreement_overrides: read own or admin" on agreement_overrides;
create policy "agreement_overrides: read own or admin"
  on agreement_overrides for select
  using (
    is_admin()
    or exists (
      select 1 from speakers s
      where s.id = agreement_overrides.speaker_id
        and s.profile_id = (select auth.uid())
    )
  );


-- ---------------------------------------------------------------------------
-- 5. Verification — fail rather than half-apply
-- ---------------------------------------------------------------------------
do $mig$
declare
  probe_a uuid;
  probe_speaker uuid;
  probe_override uuid;
begin
  -- RLS on, and read-only from the browser's side.
  if not (select relrowsecurity from pg_class where oid = 'public.agreement_templates'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.agreement_overrides'::regclass)
  then
    raise exception '0086: RLS is not enabled on both agreement tables';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('agreement_templates', 'agreement_overrides')
      and cmd <> 'SELECT'
  ) then
    raise exception '0086: an agreement table has a write policy — editing must stay server-side only';
  end if;

  -- One draft at a time.
  insert into agreement_templates (version, title, preamble, acceptance, sections, sha256)
  values ('__probe_a__', 't', 'p', 'a', '[]'::jsonb, 'h')
  returning id into probe_a;
  begin
    insert into agreement_templates (version, title, preamble, acceptance, sections, sha256)
    values ('__probe_b__', 't', 'p', 'a', '[]'::jsonb, 'h');
    raise exception '0086: a second draft was allowed — one draft at a time is load-bearing';
  exception
    when unique_violation then null;
  end;

  -- Published wording is frozen; a draft is not.
  update agreement_templates set title = 'still editable' where id = probe_a;
  update agreement_templates
    set status = 'published', published_at = now()
    where id = probe_a;
  begin
    update agreement_templates set title = 'tampered' where id = probe_a;
    raise exception '0086: published wording was editable';
  exception
    when sqlstate 'P0001' then
      if sqlerrm not like '%immutable%' then raise; end if;
  end;

  delete from agreement_templates where id = probe_a;

  -- Overrides: unique per speaker, and updated_at maintained. As in 0084,
  -- now() does not advance inside a transaction, so the probe asserts the
  -- trigger OVERWROTE a sentinel rather than that the value moved forward.
  select id into probe_speaker from speakers limit 1;
  if probe_speaker is not null then
    insert into agreement_overrides (speaker_id) values (probe_speaker)
    returning id into probe_override;

    begin
      insert into agreement_overrides (speaker_id) values (probe_speaker);
      raise exception '0086: a speaker was allowed two override rows';
    exception
      when unique_violation then null;
    end;

    update agreement_overrides
      set note = '__probe__', updated_at = timestamptz '2000-01-01 00:00:00+00'
      where id = probe_override;
    if (select updated_at from agreement_overrides where id = probe_override)
         = timestamptz '2000-01-01 00:00:00+00' then
      raise exception '0086: the updated_at trigger did not fire on UPDATE';
    end if;

    delete from agreement_overrides where id = probe_override;
  end if;

  raise notice '0086 verification passed.';
end $mig$;
