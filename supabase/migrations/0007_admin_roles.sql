-- Admin roles: one Super Admin tier above standard admins. Standard admins
-- get per-area permissions (sessions, members, announcements, sponsors,
-- content) adjustable by a super admin. Enforcement happens server-side in
-- requireAdmin(area); these columns are data, and a trigger stops non-service
-- clients from touching them (a standard admin must not self-promote via the
-- own-row profile UPDATE policy).

alter table public.profiles
  add column if not exists admin_role text
    check (admin_role in ('super', 'standard')),
  add column if not exists admin_perms jsonb not null default '{}'::jsonb;

create or replace function public.protect_admin_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is null for the service-role client (admin server actions);
  -- any authenticated user editing their own row keeps the old values.
  if auth.uid() is not null then
    new.admin_role := old.admin_role;
    new.admin_perms := old.admin_perms;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_admin_columns on public.profiles;
create trigger protect_admin_columns
  before update on public.profiles
  for each row
  execute function public.protect_admin_columns();

revoke execute on function public.protect_admin_columns() from anon, authenticated;

-- Bootstrap: the founding account is the Super Admin.
update public.profiles
   set admin_role = 'super'
 where lower(email) = 'matt@socialdrivemedia.com';
