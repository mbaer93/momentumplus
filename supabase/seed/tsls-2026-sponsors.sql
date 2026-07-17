-- TSLS 2026 sponsor + partner load (source: Matt's confirmed roster,
-- 2026-07-17, cross-checked against the Sponsors/Partners agreement folders).
--
-- Tiers use the 11-level hierarchy from migration 0025 /
-- lib/sponsor-tiers.ts (momentum_plus at the top through partner at the
-- bottom); requires 0025 to be applied first.
-- Unfilled 2026 slots (Title $15k, Platinum $7.5k, Gold #3, Lunch) are NOT
-- seeded — they get added when they sign.
-- Taglines state the factual sponsorship role; offers/websites/logos are
-- filled in via Admin → Sponsors.
-- Idempotent: skips any sponsor whose name already exists.

insert into public.sponsors (name, tier, tagline, rail_active)
select v.name, v.tier, v.tagline, v.rail_active
from (
  values
    -- The Momentum+ Sponsor (Presented by slot)
    ('Work Smarter Digital', 'momentum_plus', 'Momentum+ Sponsor', true),

    -- TSLS 2026 event sponsors -> their actual packages
    ('iWAT',                        'platinum', 'TSLS 2026 Platinum Sponsor', false),
    ('Middletown Valley Bank',      'gold', 'TSLS 2026 Gold Sponsor', false),
    ('Martin''s Potato Rolls',      'gold', 'TSLS 2026 Gold Sponsor', false),
    ('Arc Human Capital',           'silver', 'TSLS 2026 Silver Sponsor', false),
    ('Saunders Tax and Accounting', 'silver', 'TSLS 2026 Silver Sponsor', false),
    ('Smartypants Medicine',        'silver', 'TSLS 2026 Silver Sponsor', false),
    ('RM Benefits',                 'coffee_break', 'TSLS 2026 Coffee Break Sponsor', false),
    ('Meinelschmidt Distillery',    'happy_hour', 'TSLS 2026 Networking Happy Hour Sponsor', false),
    ('Gypsy Soul',                  'breakfast', 'TSLS 2026 Breakfast Sponsor', false),

    -- TSLS 2026 partners -> partner (bottom tier)
    ('Hagerstown Magazine',                  'partner', 'TSLS 2026 Partner', false),
    ('Apostrophe Communications',            'partner', 'TSLS 2026 Partner', false),
    ('Hancock Media',                        'partner', 'TSLS 2026 Partner', false),
    ('CVBA',                                 'partner', 'TSLS 2026 Partner', false),
    ('TVRC',                                 'partner', 'TSLS 2026 Partner', false),
    ('Martinsburg-Berkeley County Chamber',  'partner', 'TSLS 2026 Partner', false),
    ('Shippensburg Chamber',                 'partner', 'TSLS 2026 Partner', false),
    ('Frederick County Chamber',             'partner', 'TSLS 2026 Partner', false)
) as v(name, tier, tagline, rail_active)
where not exists (
  select 1 from public.sponsors s where lower(s.name) = lower(v.name)
);
