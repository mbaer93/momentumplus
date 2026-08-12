-- ============================================================================
-- Momentum+ migration 0088 — testimonials catch-up (Matt, 2026-08-12)
--
-- 0035_referrals_testimonials.sql was never applied to production. The two
-- tables it creates have been missing ever since, and nobody noticed because
-- the code was written to degrade: lib/testimonials.ts returns [] on error
-- and app/page.tsx renders the section only when there is something in it, so
-- the homepage has simply been hiding a feature that shipped.
--
-- This applies the TESTIMONIALS half, deliberately and on its own:
--
--   testimonials  wanted. Additive and inert on the day — the table starts
--                 empty, so the homepage section stays hidden exactly as it
--                 is now. What it unblocks is /admin/testimonials, so they
--                 can be collected and approved.
--
--   referrals     NOT applied here. It is not being withheld because it is
--                 risky to create; it is withheld because it was never
--                 agreed. The reward it once carried (a Stripe credit for a
--                 month of the referrer's plan, or a month added to a comped
--                 member's access) is deleted from the code in this same
--                 change — see lib/referrals.ts and
--                 tests/referrals-no-payout.test.ts.
--
-- WHY A NEW MIGRATION RATHER THAN HAND-APPLYING HALF OF 0035. Production's
-- migration ledger records 30 of this repo's 88 files; the rest were applied
-- straight through the SQL editor, which records nothing. That gap is exactly
-- how a whole migration went missing unnoticed. Running half of 0035 by hand
-- would add another undocumented divergence. This file is the record.
--
-- A fresh rebuild runs 0035 (creating both tables) and then this, which is a
-- no-op — `if not exists` throughout. That is fine: with the payout deleted,
-- a referrals table is inert bookkeeping wherever it exists.
--
-- Re-running this file is a no-op.
-- ============================================================================

-- Member-submitted testimonials; admin approves before anything shows on
-- the public landing page. Definition copied verbatim from 0035 so the two
-- can never disagree about the shape.
create table if not exists public.testimonials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  name text not null,              -- display name, as the member wants it shown
  role_company text,               -- e.g. "Founder, Chen Creative"
  quote text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'hidden')),
  created_at timestamptz not null default now(),
  approved_at timestamptz
);
alter table public.testimonials enable row level security;
-- No policies: service-role only, same as 0035. The landing page reads
-- through the service client, and a member's own submission goes through a
-- server action that has already established who they are.

-- ---------------------------------------------------------------------------
-- Verification — fail rather than half-apply
-- ---------------------------------------------------------------------------
do $mig$
begin
  if to_regclass('public.testimonials') is null then
    raise exception '0088: testimonials was not created';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.testimonials'::regclass) then
    raise exception '0088: RLS is not enabled on testimonials';
  end if;

  -- Service-role only, as 0035 intended. A stray policy here would expose
  -- unapproved submissions — pending quotes are somebody's unpublished words.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'testimonials'
  ) then
    raise exception '0088: testimonials has an RLS policy — it is service-role only';
  end if;

  -- The status check is what keeps an unapproved quote off the landing page.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.testimonials'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%approved%'
  ) then
    raise exception '0088: the status check constraint is missing';
  end if;

  raise notice '0088 verification passed.';
end $mig$;
