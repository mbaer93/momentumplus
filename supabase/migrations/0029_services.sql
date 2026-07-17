-- Additional Services (Matt, 2026-07-17): SLC's service offerings listed in
-- the member portal, each with details and an external sign-up link.

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tagline text,
  description text,
  url text,                       -- external sign-up link
  price_label text,               -- optional, e.g. "$500/mo" or "Custom"
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.services enable row level security;

-- Members see active services; all writes go through the service role.
drop policy if exists services_member_read on public.services;
create policy services_member_read on public.services
  for select to authenticated
  using (active = true);
