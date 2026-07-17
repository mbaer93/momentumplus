-- TSLS 2026 sponsor + partner load (source: Matt's confirmed roster,
-- 2026-07-17, cross-checked against the Sponsors/Partners agreement folders).
--
-- Momentum+ tier mapping:
--   title     = the Momentum+ Sponsor (Work Smarter Digital) — the single
--               "Presented by" slot; rail_active so it leads the ad rail.
--   partner   = TSLS 2026 event sponsors (Platinum/Gold/Silver/specialty).
--   community = TSLS 2026 partners (media/chambers/trade).
-- Unfilled 2026 slots (Title $15k, Platinum $7.5k, Gold #3, Lunch) are NOT
-- seeded — they get added when they sign.
-- Taglines state the factual sponsorship role; offers/websites/logos are
-- filled in via Admin → Sponsors.
-- Idempotent: skips any sponsor whose name already exists.

insert into public.sponsors (name, tier, tagline, rail_active)
select v.name, v.tier::sponsor_tier, v.tagline, v.rail_active
from (
  values
    -- The Momentum+ Sponsor -> title (Presented by slot)
    ('Work Smarter Digital', 'title', 'Momentum+ Sponsor', true),

    -- TSLS 2026 event sponsors -> partner
    ('iWAT',                        'partner', 'TSLS 2026 Platinum Sponsor', false),
    ('Middletown Valley Bank',      'partner', 'TSLS 2026 Gold Sponsor', false),
    ('Martin''s Potato Rolls',      'partner', 'TSLS 2026 Gold Sponsor', false),
    ('Arc Human Capital',           'partner', 'TSLS 2026 Silver Sponsor', false),
    ('Saunders Tax and Accounting', 'partner', 'TSLS 2026 Silver Sponsor', false),
    ('Smartypants Medicine',        'partner', 'TSLS 2026 Silver Sponsor', false),
    ('RM Benefits',                 'partner', 'TSLS 2026 Coffee Break Sponsor', false),
    ('Meinelschmidt Distillery',    'partner', 'TSLS 2026 Networking Happy Hour Sponsor', false),
    ('Gypsy Soul',                  'partner', 'TSLS 2026 Breakfast Sponsor', false),

    -- TSLS 2026 partners -> community
    ('Hagerstown Magazine',                  'community', 'TSLS 2026 Partner', false),
    ('Apostrophe Communications',            'community', 'TSLS 2026 Partner', false),
    ('Hancock Media',                        'community', 'TSLS 2026 Partner', false),
    ('CVBA',                                 'community', 'TSLS 2026 Partner', false),
    ('TVRC',                                 'community', 'TSLS 2026 Partner', false),
    ('Martinsburg-Berkeley County Chamber',  'community', 'TSLS 2026 Partner', false),
    ('Shippensburg Chamber',                 'community', 'TSLS 2026 Partner', false),
    ('Frederick County Chamber',             'community', 'TSLS 2026 Partner', false)
) as v(name, tier, tagline, rail_active)
where not exists (
  select 1 from public.sponsors s where lower(s.name) = lower(v.name)
);
