-- Momentum+ migration 0067: the synced sponsorship-tier catalog (Matt,
-- 2026-07-29). TSLS owns the catalog — its Admin → Event Planning editor
-- pushes the full list here via /api/bridge/tiers on every save. Momentum+
-- reads it for tier order, labels, and pricing; until the first push
-- arrives the code-defined 2026 catalog keeps everything rendering.

create table public.sponsor_tiers (
  value text primary key,
  label text not null,
  price int not null default 0,
  in_kind boolean not null default false,
  available int,
  sold_out boolean not null default false,
  vip_tickets int not null default 0,
  highlights text[] not null default '{}',
  sort int not null default 100,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.sponsor_tiers enable row level security;

create policy sponsor_tiers_read on public.sponsor_tiers
  for select to authenticated using (true);
