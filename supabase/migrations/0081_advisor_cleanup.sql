-- ============================================================================
-- Momentum+ migration 0081 — Supabase advisor cleanup, part 2
-- (audit 2026-08-06, P2-14 follow-up to 0080_rls_performance.sql)
--
-- 0080 swept the catalog for bare auth.uid() / auth.jwt() inside RLS policy
-- expressions and added covering indexes for every single-column FK. It took
-- the advisor's unindexed_foreign_keys count from 20 to 0 and its
-- auth_rls_initplan count from 41 to 1.
--
-- This migration closes the remaining two safely-closable classes:
--
--   1. auth_rls_initplan — one policy survived. 0080's catalog filter matched
--      the literal strings '%auth.uid()%' and '%auth.jwt()%' only
--      (0080_rls_performance.sql:38-51), so "podcast_episodes: read"
--      (0073_branching_out.sql:31-33), which calls auth.role(), was never a
--      candidate. Same lint, different function name.
--
--   2. function_search_path_mutable — every helper in this schema pins
--      `set search_path = public` (is_admin, can_view, current_user_tiers,
--      has_feature, library_season_ok) except three, which were written
--      without a SET clause and are the only functions in `public` with a
--      null proconfig.
--
-- WHY THESE ARE CATALOG-DRIVEN, LIKE 0080: nothing here is a hand-written
-- list of objects that can drift. Block 1 rewrites whatever bare calls exist
-- at run time; block 2 pins only the functions that are actually unpinned at
-- run time; block 3 reports anything either block declined to touch. Re-running
-- the whole file is a no-op.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO — see the ACCEPTED WARNINGS
-- block at the bottom of this file:
--   * It does not revoke EXECUTE on the six SECURITY DEFINER helpers the
--     security advisor flags (12 warnings). Revoking breaks the portal.
--   * It does not consolidate the ~101 multiple_permissive_policies warnings.
--     That changes which policy grants access and needs per-table review.
--
-- NO explicit BEGIN/COMMIT. Like every migration 0001–0080, this file is
-- applied as one implicit transaction (Supabase SQL editor / psql batch). An
-- inner COMMIT would end that transaction early and allow a half-applied
-- migration; the verification block at the end must be able to roll the whole
-- file back.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. auth_rls_initplan — wrap the remaining bare auth.* calls
--
-- Generalizes 0080's sweep from auth.uid()/auth.jwt() to the full set the
-- lint flags, so this class of miss cannot recur when someone writes a new
-- policy with auth.role(). Today it rewrites exactly one policy:
--   podcast_episodes: read  ->  using (auth.role() = 'authenticated')
--
-- Scope rules, deliberate:
--   * Only ZERO-ARGUMENT auth.* helpers are matched. A function taking a
--     column argument can legitimately vary row to row; wrapping it in a
--     scalar subquery would change results, so it is not matched.
--   * current_setting is matched ONLY in its two-argument missing_ok form,
--     current_setting('name', true), which returns NULL for an unset GUC and
--     can never raise. The one-argument form RAISES on an unset GUC, and
--     wrapping it measurably changes behaviour on an empty table (the bare
--     form errors; the wrapped form returns zero rows because the InitPlan is
--     never evaluated). That form is reported by block 3 for human review
--     rather than silently rewritten. No policy uses current_setting today;
--     this branch exists to catch future drift.
--   * The rewrite unwraps before it re-wraps, so a policy mixing an
--     already-wrapped call with a bare one cannot end up double-wrapped, and
--     a second run of this file selects nothing.
--
-- Semantics are preserved exactly: auth.role() is zero-argument and STABLE, so
-- its value cannot vary row to row within one query, and `SELECT <expr>` with
-- no FROM always returns exactly one row, so the subquery introduces no NULL.
-- Verified on a PostgreSQL 16 replica of this schema: authenticated sees the
-- same rows, anon sees the same rows, and a raw `authenticated` connection
-- with no JWT claims at all sees the same rows — before and after.
--
-- NOTE FOR REVIEWERS: do not "simplify" this policy to
-- `to authenticated using (true)`. It is not equivalent. auth.role() reads the
-- JWT `role` claim; TO authenticated matches the Postgres role the connection
-- assumed. They normally agree, but diverge for a connection made directly as
-- `authenticated` without a JWT. Access control is load-bearing here
-- (CLAUDE.md non-negotiable #1); the minimal wrap is the correct change.
-- ---------------------------------------------------------------------------
do $mig$
declare
  -- Calls whose value provably cannot vary from row to row within one query.
  call_re constant text :=
    $re$auth\.(?:uid|jwt|role|email)\(\)|current_setting\(\s*'[^']*'(?:::text)?\s*,\s*true\s*\)$re$;
  bare_re constant text := '(' || call_re || ')';
  -- A call already wrapped, as pg_policies deparses it: ( SELECT auth.uid() AS uid)
  wrapped_re constant text :=
    '\(\s*SELECT\s+(' || call_re || ')(?:\s+AS\s+[a-zA-Z_][a-zA-Z0-9_]*)?\s*\)';
  p record;
  new_qual text;
  new_check text;
  cmd text;
  n int := 0;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      -- Strip the calls that are already wrapped; if a bare call still
      -- remains, this policy needs rewriting.
      and (
        regexp_replace(coalesce(qual, ''), wrapped_re, '', 'gi') ~* bare_re
        or regexp_replace(coalesce(with_check, ''), wrapped_re, '', 'gi') ~* bare_re
      )
  loop
    new_qual := regexp_replace(
                  regexp_replace(p.qual, wrapped_re, '\1', 'gi'),
                  bare_re, '(select \1)', 'gi');
    new_check := regexp_replace(
                  regexp_replace(p.with_check, wrapped_re, '\1', 'gi'),
                  bare_re, '(select \1)', 'gi');

    cmd := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if new_qual is not null then
      cmd := cmd || format(' using (%s)', new_qual);
    end if;
    if new_check is not null then
      cmd := cmd || format(' with check (%s)', new_check);
    end if;

    raise notice 'auth_rls_initplan: rewriting %.% policy "%"',
      p.schemaname, p.tablename, p.policyname;
    execute cmd;
    n := n + 1;
  end loop;

  raise notice 'auth_rls_initplan: rewrote % policy/policies (expected 1: podcast_episodes: read)', n;
end $mig$;


-- ---------------------------------------------------------------------------
-- 2. function_search_path_mutable — pin search_path on the unpinned helpers
--
-- Three functions in `public` have a null proconfig. All three are SECURITY
-- INVOKER, so this is pure name-resolution hardening with no access-control
-- consequence — it cannot change who sees what.
--
--   public.season_of(timestamptz)                       0055:133
--   public.current_library_season()                     0055:146
--   public.membership_grants_access(membership_status, timestamptz)   0002:18
--
-- membership_grants_access is included because the catalog says it is
-- unpinned, even though the production advisor screenshot dated 2026-08-07
-- listed only the first two. Either the screenshot was short and the advisor
-- really reports three, or production drifted from the migration chain for
-- this one function. The block below pins only what is actually unpinned at
-- run time, so it is correct under either reading and clobbers nothing that
-- already carries a search_path.
--
-- WHY `public` AND NOT `''`: `set search_path = ''` is the stronger form, but
-- it requires every unqualified reference in the body to be schema-qualified,
-- and ALTER FUNCTION does NOT re-validate the body. current_library_season()
-- calls `season_of(now())` bare — pinning it to '' applies silently and then
-- raises at RUNTIME:
--     ERROR: function season_of(timestamp with time zone) does not exist
--     CONTEXT: SQL function "current_library_season" during startup
--              SQL function "library_season_ok" statement 1
-- i.e. inside library_season_ok(), inside the "videos: read published visible"
-- policy — the whole Library 500s for every member, from a migration that
-- deployed green. Reproduced on a PostgreSQL 16 replica.
--
-- `public` needs no body rewrite for any of the three, matches what every
-- other helper in this schema already uses, and satisfies the lint identically
-- (the lint tests only that a search_path IS set, not what it is set to —
-- which is why is_admin/can_view/current_user_tiers/has_feature/
-- library_season_ok, all pinned to `public`, are not flagged). pg_temp is
-- deliberately omitted: none of these touch temp objects, and leaving it out
-- removes a shadowing surface rather than adding one.
--
-- KNOWN, ACCEPTED TRADE-OFF: a non-null proconfig disqualifies a SQL function
-- from inline_function(), so season_of() stops being folded into the videos
-- policy's scan filter and becomes a real per-row call (~2.4us/row measured on
-- a synthetic 200k-row table). public.videos holds session recordings — tens
-- to low hundreds of rows — so this is sub-millisecond in practice. Revisit if
-- the library grows large, or if an expression index over
-- season_of(published_at) is ever added.
-- ---------------------------------------------------------------------------
do $mig$
declare
  fn_row record;
  pinned int := 0;
begin
  for fn_row in
    select ns.nspname as sch,
           pr.proname as fn,
           pg_get_function_identity_arguments(pr.oid) as args,
           pr.oid::regprocedure::text as sig
    from pg_proc pr
    join pg_namespace ns on ns.oid = pr.pronamespace
    where ns.nspname = 'public'
      -- never touch anything an extension owns
      and not exists (
        select 1 from pg_depend dep where dep.objid = pr.oid and dep.deptype = 'e'
      )
      and (
        pr.proconfig is null
        or not exists (
          select 1 from unnest(pr.proconfig) cfg where cfg like 'search_path=%'
        )
      )
  loop
    raise notice 'function_search_path_mutable: pinning search_path = public on %', fn_row.sig;
    execute format('alter function %I.%I(%s) set search_path = public',
                   fn_row.sch, fn_row.fn, fn_row.args);
    pinned := pinned + 1;
  end loop;

  raise notice 'function_search_path_mutable: pinned % function(s) (expected 3, or fewer if prod already pinned some)', pinned;
end $mig$;


-- ---------------------------------------------------------------------------
-- 3. Verification — fail the whole migration rather than half-apply it.
--
-- Hard assertions cover the two classes this file claims to close. The audit
-- NOTICEs cover the case block 1 deliberately declines to rewrite (the raising
-- one-argument current_setting form), so a skipped case is visibly documented
-- as accepted rather than silently dropped.
-- ---------------------------------------------------------------------------
do $mig$
declare
  call_re constant text :=
    $re$auth\.(?:uid|jwt|role|email)\(\)|current_setting\(\s*'[^']*'(?:::text)?\s*,\s*true\s*\)$re$;
  bare_re constant text := '(' || call_re || ')';
  wrapped_re constant text :=
    '\(\s*SELECT\s+(' || call_re || ')(?:\s+AS\s+[a-zA-Z_][a-zA-Z0-9_]*)?\s*\)';
  bad text;
  pol record;
  leftover int := 0;
begin
  -- (a) no bare, wrappable auth.* / current_setting(x, true) call may remain.
  select string_agg(format('%s."%s"', tablename, policyname), ', ')
    into bad
  from pg_policies
  where schemaname = 'public'
    and (
      regexp_replace(coalesce(qual, ''), wrapped_re, '', 'gi') ~* bare_re
      or regexp_replace(coalesce(with_check, ''), wrapped_re, '', 'gi') ~* bare_re
    );
  if bad is not null then
    raise exception 'auth_rls_initplan: bare call still present on: %', bad;
  end if;

  -- (b) no non-extension function in public may be left with a mutable search_path.
  select string_agg(pr.oid::regprocedure::text, ', ')
    into bad
  from pg_proc pr
  join pg_namespace ns on ns.oid = pr.pronamespace
  where ns.nspname = 'public'
    and not exists (select 1 from pg_depend dep where dep.objid = pr.oid and dep.deptype = 'e')
    and (
      pr.proconfig is null
      or not exists (select 1 from unnest(pr.proconfig) cfg where cfg like 'search_path=%')
    );
  if bad is not null then
    raise exception 'function_search_path_mutable: search_path still unpinned on: %', bad;
  end if;

  -- (c) smoke-test the season chain under its new pinned search_path.
  --     October 1 Eastern is the season boundary (0055).
  if public.season_of('2026-09-30 23:59:59-04'::timestamptz) is distinct from 2025
     or public.season_of('2026-10-01 00:00:00-04'::timestamptz) is distinct from 2026
     or public.season_of(null::timestamptz) is not null
     or public.current_library_season() is null
  then
    raise exception 'season_of/current_library_season changed behaviour after pinning search_path';
  end if;

  -- (d) smoke-test the grace-period helper under its new pinned search_path.
  if public.membership_grants_access('active'::public.membership_status, null::timestamptz) is not true
     or public.membership_grants_access('expired'::public.membership_status, now() + interval '1 year') is not false
     or public.membership_grants_access('past_due'::public.membership_status, now() + interval '1 day') is not true
     or public.membership_grants_access('past_due'::public.membership_status, now() - interval '1 day') is not false
  then
    raise exception 'membership_grants_access changed behaviour after pinning search_path';
  end if;

  -- (e) audit only: anything the lint flags that block 1 deliberately would not
  --     rewrite (today: only the raising one-argument current_setting form).
  for pol in
    select tablename, policyname,
           coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
    from pg_policies
    where schemaname = 'public'
  loop
    if (select count(*) from regexp_matches(pol.expr,
          '(auth\.[a-z_]+\s*\(|current_setting\s*\()', 'gi'))
       > (select count(*) from regexp_matches(pol.expr,
          '\(\s*SELECT\s+(auth\.[a-z_]+\s*\(|current_setting\s*\()', 'gi'))
    then
      leftover := leftover + 1;
      raise notice 'advisor: NOT rewritten, needs human review: %."%" -> %',
        pol.tablename, pol.policyname, pol.expr;
    end if;
  end loop;
  raise notice 'advisor: % policy/policies left deliberately unwrapped (expected 0)', leftover;

  raise notice '0081 verification passed.';
end $mig$;


-- ============================================================================
-- ACCEPTED WARNINGS — assessed and deliberately NOT fixed here.
--
-- A. "Public Can Execute SECURITY DEFINER Function" x6 (grantee anon) and
--    "Signed-In Users Can Execute SECURITY DEFINER Function" x6 (grantee
--    authenticated), naming public.can_view(access_level),
--    public.current_user_tiers(), public.has_feature(text), public.is_admin(),
--    public.lesson_completable_by_member(uuid), public.library_season_ok(int).
--
--    NOT FIXED. PostgreSQL permission-checks function calls inside RLS policy
--    USING / WITH CHECK expressions against the QUERYING role. SECURITY
--    DEFINER does not exempt the call — the definer context governs the
--    function BODY, not the caller's right to invoke it. Verified on a
--    PostgreSQL 16 replica of this schema: revoking EXECUTE on is_admin()
--    makes an ordinary member SELECT fail with
--    "ERROR: permission denied for function is_admin" — a hard error, not an
--    empty result — and re-granting fixes it immediately. A true OR branch does
--    not rescue the query: the announcements policy
--    (is_admin() OR sent_at IS NOT NULL) still errors on a row whose sent_at
--    is set. Blast radius: is_admin() backs 44 policies across 29 tables,
--    can_view() 9 policies across 8 tables, plus the sponsor ad rail
--    (current_user_tiers), the Library (library_season_ok) and lesson
--    completion / CE certificates (lesson_completable_by_member).
--
--    Note also that the obvious "surgical" revoke is a no-op: all six carry
--    Postgres's default EXECUTE-to-PUBLIC, so revoking from anon/authenticated
--    alone leaves has_function_privilege() true and clears nothing. The variant
--    that does clear the warning (revoke from PUBLIC, re-grant to
--    authenticated) breaks every logged-out read of those 29 tables — including
--    the signed-out pricing grid, which reads member_tiers, a table carrying a
--    FOR ALL admin policy that calls is_admin().
--
--    Residual exposure is low and bounded: all six are strictly
--    self-referential. Each resolves its subject from auth.uid() and none
--    accepts a "which user" argument, so an RPC caller learns only a boolean or
--    an array about THEMSELVES — facts already rendered in their own UI. There
--    is no cross-tenant read and no privilege escalation. All six already pin
--    search_path = public, closing the one genuine hazard of the pattern. The
--    advisor is matching the generic shape "SECURITY DEFINER + anon/
--    authenticated EXECUTE", which is inherent to the Supabase-recommended
--    RLS-helper pattern this whole schema is built on (CLAUDE.md
--    non-negotiable #1: access control lives in the database).
--
--    has_feature(text) is the one function of the six with zero call sites
--    today (0 policies, 0 function bodies, 0 triggers, 0 RPC callers — feature
--    gating is done in TypeScript at lib/entitlements.ts). Revoking it alone
--    would break nothing now, but it clears only 2 of 14 warnings and arms a
--    trap: the first `using (has_feature('x'))` policy anyone writes would
--    hard-error for every member with a message pointing at permissions rather
--    than at the new policy. It is kept grouped with the other five.
--
--    The only correct route to genuinely clearing these 12 is to stop calling
--    these helpers from policies at all — e.g. carry tier/admin state in JWT
--    app_metadata and read it via (select auth.jwt()), which needs no function
--    grant. That is a design change, not a migration, and belongs in its own
--    phase.
--
-- B. multiple_permissive_policies x ~101. NOT FIXED, unchanged from 0080.
--    Consolidating overlapping permissive policies changes which policy grants
--    access; it needs per-table review, not a sweep.
-- ============================================================================
