-- ============================================================================
-- Momentum+ migration 0083 — Leadership Advisor Agreement gate
-- (Sierra's draft dated 2026-08-10; built 2026-08-11)
--
-- The "Momentum+ Leadership Advisor Agreement" is signed in-app before an
-- Advisor can use Speaker Studio. Two pieces:
--
--   1. speakers gains the living fields the agreement collects that the rest
--      of the platform actually uses: organization (§9 lists Organization
--      among the profile fields shown in the community) and the anticipated
--      featured session date/time (§2). Featured Month already exists as
--      speakers.speaker_month (0053) and is assigned by an admin, not by the
--      Advisor — the signing form shows it read-only.
--
--   2. advisor_agreements is an APPEND-ONLY signature ledger: one row per
--      signature event. §32 lets the agreement be amended, so one Advisor can
--      hold rows for more than one version, and each row snapshots the blanks
--      as they stood at signing. The live speakers columns drift afterwards
--      (§2 lets SLC move the month, §17 lets the session move with it); the
--      snapshot is what the person actually agreed to.
--
-- WHY PHONE IS NOT ON speakers: the "speakers: read for members" policy
-- (0001, rewritten 0002) lets every active member select whole speaker rows.
-- Organization is meant to be visible (§9 lists it); a phone number is a
-- contact detail collected for SLC and is NOT in §9's list. It lives only on
-- advisor_agreements, which is readable by admins and the signer alone.
--
-- WHY THE HASH: agreement_sha256 is the SHA-256 of the exact agreement body
-- rendered on screen at signing (lib/advisor-agreement.ts, canonical form).
-- A version string can be reused by mistake; the hash cannot. If the wording
-- is ever edited, already-signed rows keep the hash of the text their signer
-- actually read, so "which words did this person agree to" stays answerable.
--
-- Re-running this file is a no-op.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. speakers — the agreement's living fields
-- ---------------------------------------------------------------------------
alter table speakers
  add column if not exists organization text,
  add column if not exists featured_session_date date,
  add column if not exists featured_session_time text,
  add column if not exists advisor_agreement_waived boolean not null default false;

comment on column speakers.organization is
  'Advisor''s organization, collected on the Leadership Advisor Agreement. Member-visible: §9 lists Organization among the community profile fields.';
comment on column speakers.featured_session_date is
  'Anticipated Featured Session Date from §2 of the Leadership Advisor Agreement. An intention, not a booking — the real event is a row in sessions.';
comment on column speakers.featured_session_time is
  'Anticipated Featured Session Time from §2, free text (e.g. "12:00 PM ET"). Text, not time: an anticipated slot is often written loosely and carries no date to anchor a zone to.';
comment on column speakers.advisor_agreement_waived is
  'Admin-only escape hatch: true lets this speaker into Speaker Studio without an in-app signature (signed on paper, or not an Advisor). Default false. TSLS Main Speakers are already exempt without it — §1 makes the Advisor role explicitly distinct from a mainstage speaker role.';


-- ---------------------------------------------------------------------------
-- 2. advisor_agreements — the signature ledger
-- ---------------------------------------------------------------------------
create table if not exists advisor_agreements (
  id uuid primary key default gen_random_uuid(),
  speaker_id uuid not null references speakers (id) on delete cascade,
  -- Who actually clicked sign. Kept separate from speaker_id because a
  -- speaker row can be re-pointed at a different account later; the person
  -- who signed does not change retroactively.
  profile_id uuid references profiles (id) on delete set null,

  agreement_version text not null,
  agreement_sha256 text not null,

  -- The typed signature and when it was made.
  signed_name text not null,
  signed_at timestamptz not null default now(),

  -- Snapshot of the agreement's own blanks, as filled at signing.
  advisor_name text not null,
  organization text,
  email text,
  phone text,
  effective_date date,
  featured_month text
    check (featured_month is null or featured_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  featured_session_date date,
  featured_session_time text,

  -- Evidentiary context for the signature event.
  signed_ip text,
  signed_user_agent text
);

comment on table advisor_agreements is
  'Append-only signature ledger for the Momentum+ Leadership Advisor Agreement. One row per signature event; rows are never edited (see the immutability trigger below). A new agreement version means a new row, not an update.';

create index if not exists advisor_agreements_speaker_idx
  on advisor_agreements (speaker_id, signed_at desc);
create index if not exists advisor_agreements_profile_idx
  on advisor_agreements (profile_id);


-- ---------------------------------------------------------------------------
-- 3. Immutability — a signature record's contents must never change
--
-- RLS (below) already keeps every browser-side client out of writes, but the
-- server signs through the service role, which bypasses RLS. Triggers do not
-- bypass, so this is what actually makes the ledger append-only.
--
-- UPDATE is blocked; DELETE deliberately is not. A wrong row is removed and
-- re-signed, which leaves no half-edited record behind — and an admin has to
-- be able to clear a test signature made while setting the program up.
-- ---------------------------------------------------------------------------
create or replace function advisor_agreements_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception
    'advisor_agreements rows are immutable — a signature record cannot be edited. Delete the row and sign again.';
end;
$$;

drop trigger if exists advisor_agreements_no_update on advisor_agreements;
create trigger advisor_agreements_no_update
  before update on advisor_agreements
  for each row execute function advisor_agreements_immutable();


-- ---------------------------------------------------------------------------
-- 4. RLS — admins and the signer can read; nobody writes but the server
--
-- Deliberately NO insert/update/delete policy. Signing runs in a server
-- action through the service role, so the only write path is code that has
-- already checked who the caller is. Adding an insert policy here would let a
-- member POST a signature row straight at PostgREST with any name on it.
-- ---------------------------------------------------------------------------
alter table advisor_agreements enable row level security;

drop policy if exists "advisor_agreements: read own or admin" on advisor_agreements;
create policy "advisor_agreements: read own or admin"
  on advisor_agreements for select
  using (
    is_admin()
    or exists (
      select 1 from speakers s
      where s.id = advisor_agreements.speaker_id
        and s.profile_id = (select auth.uid())
    )
  );


-- ---------------------------------------------------------------------------
-- 5. Verification — fail rather than half-apply
-- ---------------------------------------------------------------------------
do $mig$
declare
  agreement_id uuid;
  speaker_id_for_test uuid;
begin
  -- (a) the columns landed
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'speakers'
        and column_name in ('organization', 'featured_session_date',
                            'featured_session_time', 'advisor_agreement_waived')) <> 4
  then
    raise exception '0083: speakers is missing one of the advisor-agreement columns';
  end if;

  -- (b) RLS is on and read-only (no write policy of any kind)
  if not (select relrowsecurity from pg_class where oid = 'public.advisor_agreements'::regclass) then
    raise exception '0083: RLS is not enabled on advisor_agreements';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'advisor_agreements'
      and cmd <> 'SELECT'
  ) then
    raise exception '0083: advisor_agreements has a write policy — signing must stay server-side only';
  end if;

  -- (c) the immutability trigger actually fires. Uses a real speaker row so
  --     the FK holds, and rolls the whole probe back via a savepoint.
  select id into speaker_id_for_test from speakers limit 1;
  if speaker_id_for_test is not null then
    begin
      insert into advisor_agreements
        (speaker_id, agreement_version, agreement_sha256, signed_name, advisor_name)
      values
        (speaker_id_for_test, '__probe__', '__probe__', '__probe__', '__probe__')
      returning id into agreement_id;

      begin
        update advisor_agreements set signed_name = 'tampered' where id = agreement_id;
        raise exception '0083: the immutability trigger did not block an UPDATE';
      exception
        when sqlstate 'P0001' then
          -- Expected: either our own guard above or the trigger. Only the
          -- trigger's message means the trigger fired.
          if sqlerrm not like '%immutable%' then
            raise;
          end if;
      end;

      delete from advisor_agreements where id = agreement_id;
    end;
  end if;

  raise notice '0083 verification passed.';
end $mig$;
