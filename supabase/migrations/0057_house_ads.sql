-- ============================================================================
-- Momentum+ migration 0057: the last hard-coded placements become ad rows
-- (Matt, 2026-07-28: "There should already be the Momentum+ Sponsor in 2
-- locations and the become a partner should be on here as well, they should
-- both be editable and moveable in here.")
--
-- Until now the Ad Manager showed its slots empty while the app still
-- rendered three things into them from code: the Momentum+ Sponsor's rail
-- card, its in-page banner/tile ad, and the "Become a partner" rail card.
-- This seeds those as real ads rows, and the renderers now read the rows.
--
-- Sponsor-linked rows are seeded with BLANK title/body/image on purpose:
-- blank fields inherit from the sponsor's profile (name, tagline, uploaded
-- ad creative) at render time, so the creative keeps being managed in
-- Admin → Sponsors and the row only decides placement, order, and flight.
-- Filling a field in the Ad Manager overrides the inherited value.
-- ============================================================================

-- The Momentum+ Sponsor's rail card (previously always led the rail).
insert into ads (placement_key, kind, title, sponsor_id, sort)
select 'rail', 'ad', '', s.id, 10
from sponsors s
where s.tier = 'momentum_plus'
  and s.archived_at is null
  and not exists (
    select 1 from ads a
    where a.placement_key = 'rail' and a.sponsor_id = s.id
  );

-- The in-page placements (previously: Momentum+ Sponsor and Title Sponsor,
-- rendered by code on every list/grid page). One row per placement so each
-- can be reordered or switched off on its own.
insert into ads (placement_key, kind, title, sponsor_id, sort)
select p.key, 'ad', '', s.id,
       case when s.tier = 'momentum_plus' then 10 else 20 end
from sponsors s
cross join (values ('body_banner'), ('body_tile')) as p (key)
where s.tier in ('momentum_plus', 'title')
  and s.archived_at is null
  and not exists (
    select 1 from ads a
    where a.placement_key = p.key and a.sponsor_id = s.id
  );

-- The "Become a partner" card (previously hard-coded at the rail's foot).
insert into ads (placement_key, kind, title, body, cta_label, url, sort)
select 'rail', 'notice', 'Become a partner',
       'Put your brand in front of a national community of engaged leaders. New partners are considered when 2027 sponsorships open in April.',
       'Become a Partner',
       'https://event.tristateleadershipsummit.com/sponsor',
       100
where not exists (
  select 1 from ads a
  where a.placement_key = 'rail' and a.kind = 'notice'
    and a.title = 'Become a partner'
);
