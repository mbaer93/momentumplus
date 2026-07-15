-- Sponsors can carry two graphics: a logo (profile/cards) and a sidebar ad
-- creative shown in the left panel "Presented by" slot.
alter table public.sponsors
  add column if not exists sidebar_ad_url text;
