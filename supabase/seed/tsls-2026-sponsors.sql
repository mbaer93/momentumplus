-- TSLS 2026 sponsor load (source: "09 - TSLS 2026 Sponsor Tracker" sheet,
-- all returning 2025 sponsors, per Matt 2026-07-17).
-- Tier mapping: Platinum/Gold/Silver -> partner; Community + trade -> community.
-- The single 'title' (Presented by) slot stays empty until the 2026 title
-- sponsor signs. Taglines/offers/websites/logos intentionally left blank —
-- filled in via Admin → Sponsors rather than invented here.
-- Idempotent: skips any sponsor whose name already exists.

insert into public.sponsors (name, tier, rail_active)
select v.name, v.tier::sponsor_tier, false
from (
  values
    -- Platinum / Gold / Silver 2025 -> partner
    ('Barley Snyder',                 'partner'),
    ('Middletown Valley Bank',        'partner'),
    ('Martin''s',                     'partner'),
    ('Work Smarter (Bev Stitely)',    'partner'),
    -- Community 2025 -> community
    ('Work Smarter Digital',          'community'),
    ('F&M Trust',                     'community'),
    ('Michelle Compton',              'community'),
    ('CMH Home Loans',                'community'),
    ('Preston Sphar',                 'community'),
    ('Eric Jorgenson',                'community'),
    ('Donna Digman',                  'community'),
    ('SERVPRO (Bill Humphrey)',       'community'),
    ('Edward Jones',                  'community'),
    -- Trade partners 2025 -> community
    ('Washington County Chamber of Commerce', 'community'),
    ('TVRC',                          'community'),
    ('Hagerstown Magazine',           'community'),
    ('Shippensburg Chamber of Commerce', 'community'),
    ('CVBA',                          'community')
) as v(name, tier)
where not exists (
  select 1 from public.sponsors s where lower(s.name) = lower(v.name)
);
