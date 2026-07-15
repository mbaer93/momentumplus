-- New member levels (Basic / Gift / VIP / Pro), the pro-only content gate,
-- and membership sources for the Zapier/Stripe/sponsor pipelines.
-- Enum additions live alone in this migration: Postgres won't let a new enum
-- value be referenced in the same transaction that adds it, so the functions
-- and tables that use these land in 0009.

alter type access_tier add value if not exists 'basic';
alter type access_tier add value if not exists 'gift';
alter type access_tier add value if not exists 'vip';
alter type access_tier add value if not exists 'pro';

alter type access_level add value if not exists 'pro_only';

alter type membership_source add value if not exists 'zapier';
alter type membership_source add value if not exists 'stripe';
alter type membership_source add value if not exists 'sponsor';
