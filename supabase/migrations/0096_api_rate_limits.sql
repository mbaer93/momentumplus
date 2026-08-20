-- Inbound rate ceilings for the x-api-key surfaces
-- (TSLS security review, 2026-08-19, mitigation 2 — "inbound rate ceilings on
-- all x-api-key surfaces, even crude ones").
--
-- The bridge and webhook routes had no inbound limit of any kind. The key is
-- the control; this is the bound on what a leaked one can do before anybody
-- notices — provisioning thousands of accounts, or hammering the reveal.
--
-- Fixed windows rather than a sliding log: a counter row per (surface,
-- window) is one atomic upsert, and the precision a sliding window buys is
-- worth nothing here. A caller can burst up to 2x a ceiling across a window
-- boundary; against "someone has our key", that is noise.
--
-- SECURITY DEFINER because the callers are service-role routes and the table
-- must never be reachable from PostgREST by a member. RLS on with no policy:
-- service_role only, matching every other admin-side table.

create table if not exists api_rate_counters (
  -- "<surface>:<window seconds>:<window start epoch>" — the window start is
  -- IN the key, so a new window is a new row and there is no reset to race.
  bucket text primary key,
  count integer not null default 0,
  window_start timestamptz not null default now()
);

alter table api_rate_counters enable row level security;

create index if not exists api_rate_counters_window_idx
  on api_rate_counters (window_start);

/*
 * Increment one bucket and return the new count. Atomic: the upsert's
 * ON CONFLICT DO UPDATE takes a row lock, so two concurrent requests cannot
 * both read 9 and write 10.
 *
 * Prunes only when a window is FIRST created (count = 1), which is at most
 * once per window per surface — cheap, and it keeps the table from growing
 * without adding a cron nobody would notice had died.
 */
create or replace function public.api_rate_bump(
  p_bucket text,
  p_window_start timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_count integer;
begin
  insert into public.api_rate_counters (bucket, count, window_start)
  values (p_bucket, 1, p_window_start)
  on conflict (bucket)
    do update set count = public.api_rate_counters.count + 1
  returning count into new_count;

  if new_count = 1 then
    delete from public.api_rate_counters
    where window_start < now() - interval '2 hours';
  end if;

  return new_count;
end;
$$;

revoke execute on function public.api_rate_bump(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_rate_bump(text, timestamptz) to service_role;
