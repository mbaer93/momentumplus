-- Referrals + testimonials (Matt, 2026-07-17).

-- Each member gets a shareable code (generated lazily on first visit to
-- their profile). /join?ref=CODE attributes the signup; when the referred
-- member's first payment lands, the referrer earns a free month.
alter table public.profiles
  add column if not exists referral_code text unique;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_profile_id uuid not null references public.profiles(id) on delete cascade,
  referred_profile_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  reward text,                     -- e.g. "stripe_credit" | "access_extended"
  created_at timestamptz not null default now(),
  unique (referred_profile_id)     -- one attribution per new member, ever
);
alter table public.referrals enable row level security;
-- No policies: service-role only.
create index if not exists referrals_referrer_idx
  on public.referrals (referrer_profile_id);

-- Member-submitted testimonials; admin approves before anything shows on
-- the public landing page.
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
-- No policies: service-role only.
