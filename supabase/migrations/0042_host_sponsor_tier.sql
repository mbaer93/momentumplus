-- Host Sponsor tier (Matt, 2026-07-20): the platform host's own business
-- (Sierra's), above Momentum+ Sponsor, with no end date. The sponsors.tier
-- CHECK from 0025 predates it — recreate the constraint with 'host' allowed.

alter table public.sponsors
  drop constraint if exists sponsors_tier_check;

alter table public.sponsors
  add constraint sponsors_tier_check check (tier in (
    'host', 'momentum_plus', 'title', 'platinum', 'gold', 'lunch',
    'happy_hour', 'breakfast', 'silver', 'coffee_break', 'community',
    'partner'
  ));
