-- Does this account actually have a password? (Rob, via Matt, 2026-08-19.)
--
-- The speaker and sponsor setup forms asked for a password whenever the
-- INVITE had created the account — which is not the same question. Rob set
-- a password through a recovery link, was routed straight into speaker
-- setup, and was asked to choose one again on the next screen. His words:
-- "why would this have a password field on this page also? It did require
-- me to change my password."
--
-- account_created answers "did we make this account for them". This answers
-- "have they set a password yet", which is what the form actually needs.
--
-- SECURITY DEFINER for the same reason auth_activity is (migration 0024):
-- auth.users is not reachable through PostgREST. It returns a BOOLEAN and
-- never the hash — nothing about the password itself leaves the database.

create or replace function public.auth_has_password(ids uuid[])
returns table (
  id uuid,
  has_password boolean
)
language sql
security definer
set search_path = ''
as $$
  select
    u.id,
    coalesce(u.encrypted_password, '') <> '' as has_password
  from auth.users u
  where u.id = any(ids)
$$;

revoke execute on function public.auth_has_password(uuid[]) from public, anon, authenticated;
grant execute on function public.auth_has_password(uuid[]) to service_role;
