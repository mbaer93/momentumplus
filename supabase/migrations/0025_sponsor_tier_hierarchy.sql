-- Sponsor tier hierarchy (Matt, 2026-07-17): replace the 3-value
-- sponsor_tier enum with the full 11-level ladder, top to bottom:
--   momentum_plus > title > platinum > gold > lunch > happy_hour >
--   breakfast > silver > coffee_break > community > partner
-- The column becomes text + CHECK so future tier edits don't need enum
-- surgery; ordering lives in lib/sponsor-tiers.ts.

alter table public.sponsors
  alter column tier drop default,
  alter column tier type text using tier::text;

-- Remap the rows seeded before the hierarchy existed.
-- The old 'title' tier meant "Momentum+ Sponsor".
update public.sponsors set tier = 'momentum_plus' where tier = 'title';

-- The 2026 event sponsors were parked under the old 'partner' tier —
-- restore their real packages (matched by seeded name).
update public.sponsors set tier = 'platinum'     where tier = 'partner' and lower(name) = 'iwat';
update public.sponsors set tier = 'gold'         where tier = 'partner' and lower(name) in ('middletown valley bank', 'martin''s potato rolls');
update public.sponsors set tier = 'silver'       where tier = 'partner' and lower(name) in ('arc human capital', 'saunders tax and accounting', 'smartypants medicine');
update public.sponsors set tier = 'coffee_break' where tier = 'partner' and lower(name) = 'rm benefits';
update public.sponsors set tier = 'happy_hour'   where tier = 'partner' and lower(name) = 'meinelschmidt distillery';
update public.sponsors set tier = 'breakfast'    where tier = 'partner' and lower(name) = 'gypsy soul';

-- The old 'community' tier held the trade/media partners — that's the
-- bottom 'partner' tier in the new ladder. (Order matters: the event-
-- sponsor remaps above already consumed the old 'partner' rows.)
update public.sponsors set tier = 'partner' where tier = 'community';

alter table public.sponsors
  add constraint sponsors_tier_check check (tier in (
    'momentum_plus', 'title', 'platinum', 'gold', 'lunch', 'happy_hour',
    'breakfast', 'silver', 'coffee_break', 'community', 'partner'
  )),
  alter column tier set default 'partner';

-- The enum is no longer referenced by any column.
drop type if exists sponsor_tier;
