-- RLS performance (audit 2026-08-06, P2-14).
--
-- 1. auth_rls_initplan: the Supabase advisor flagged 41 policies that call
--    auth.uid() / auth.jwt() directly in USING / WITH CHECK. Postgres
--    re-evaluates a bare function call PER ROW; wrapping it as
--    (select auth.uid()) makes it an InitPlan evaluated ONCE per query.
--    Same result, per-query instead of per-row cost — this is the
--    documented Supabase optimization.
--
-- 2. unindexed_foreign_keys: 20 FKs had no covering index, which makes
--    every parent-row delete/update (and many joins) a sequential scan of
--    the child table.
--
-- Both fixes are derived from the live catalog AT RUN TIME rather than a
-- hand-written list: this migration wraps exactly the policies that exist
-- and indexes exactly the FKs that lack one — nothing hard-coded to drift
-- out of date, and re-running it is a no-op (already-wrapped policies no
-- longer match; create index uses IF NOT EXISTS).
--
-- Deliberately NOT here: consolidating the 101 overlapping permissive
-- policies. That changes which policy grants access and needs per-table
-- review, not a sweep.

-- ---------------------------------------------------------------------------
-- 1. Wrap bare auth.uid()/auth.jwt() calls in policy expressions
-- ---------------------------------------------------------------------------
do $$
declare
  p record;
  new_qual text;
  new_check text;
  cmd text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        (qual is not null
          and qual like '%auth.uid()%'
          and qual !~* 'select\s+auth\.uid')
        or (qual is not null
          and qual like '%auth.jwt()%'
          and qual !~* 'select\s+auth\.jwt')
        or (with_check is not null
          and with_check like '%auth.uid()%'
          and with_check !~* 'select\s+auth\.uid')
        or (with_check is not null
          and with_check like '%auth.jwt()%'
          and with_check !~* 'select\s+auth\.jwt')
      )
  loop
    -- pg_policies deparses expressions canonically, so the bare calls
    -- appear exactly as auth.uid() / auth.jwt().
    new_qual := replace(replace(p.qual,
        'auth.uid()', '(select auth.uid())'),
        'auth.jwt()', '(select auth.jwt())');
    new_check := replace(replace(p.with_check,
        'auth.uid()', '(select auth.uid())'),
        'auth.jwt()', '(select auth.jwt())');

    cmd := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if new_qual is not null then
      cmd := cmd || format(' using (%s)', new_qual);
    end if;
    if new_check is not null then
      cmd := cmd || format(' with check (%s)', new_check);
    end if;
    execute cmd;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Covering indexes for single-column foreign keys that have none
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  idx_name text;
begin
  for r in
    select
      cl.relname as tbl,
      a.attname as col
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace
      and array_length(c.conkey, 1) = 1
      -- covered when ANY index leads with the FK column
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = c.conrelid
          and i.indkey[0] = c.conkey[1]
      )
  loop
    -- Postgres identifier limit is 63 bytes; keep names deterministic so
    -- IF NOT EXISTS makes reruns no-ops.
    idx_name := left(r.tbl || '_' || r.col || '_fk_idx', 63);
    execute format('create index if not exists %I on public.%I (%I)',
      idx_name, r.tbl, r.col);
  end loop;
end $$;
