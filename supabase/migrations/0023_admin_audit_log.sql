-- Admin audit trail. Sensitive admin actions — minting a member login link
-- (which grants sign-in as that member), deleting a member, changing admin
-- access — are recorded here so there is an accountable record of who did
-- what to whom. Super-admin readable; written only by the service role.
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id) on delete set null,
  actor_email text,
  action text not null,          -- e.g. 'login_link', 'delete_member', 'set_admin_access'
  target_profile_id uuid,        -- not an FK: survives the target's deletion
  target_email text,
  detail text,
  at timestamptz not null default now()
);

create index if not exists admin_audit_log_at_idx
  on public.admin_audit_log (at desc);

alter table public.admin_audit_log enable row level security;

-- Super Admin can read; nobody writes through the client (service role only).
create policy "admin_audit: super read" on public.admin_audit_log
  for select using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.admin_role = 'super'
    )
  );
