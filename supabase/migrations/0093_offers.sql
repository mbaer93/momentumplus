-- Member offers: a targeted deal shown in the app (Matt, 2026-08-19 — badges
-- exist so that special deals can be aimed at the people who hold them).
--
-- The offer is CONTENT, not a price. Title, body, a button label, and a URL
-- the admin supplies — a Stripe payment link, a GHL funnel, a form. Nothing
-- here mints a discount or knows what anything costs, so this file never has
-- to agree with pricing that lives elsewhere.

create table if not exists offers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  cta_label text,
  cta_url text,
  -- Who sees it. Badge keys (lib/badges.ts) and/or membership tiers, UNIONed
  -- the same way announcement audiences are: holding EITHER is enough.
  audience_badges text[] not null default '{}',
  audience_tiers text[] not null default '{}',
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references profiles (id) on delete set null
);

comment on table offers is
  'Targeted in-app offers. Shown to members holding a listed badge or tier, within the date window, while active.';

create index if not exists offers_live_idx
  on offers (active, ends_at) where active;

/*
 * A member closing an offer should not see it again.
 *
 * TWO foreign keys, which is the shape that broke every session page on
 * 2026-08-12 (see CLAUDE.md): a junction table gives PostgREST a second
 * path between the tables it joins, and every existing embed between that
 * pair stops resolving with PGRST201. The pair here is offers↔profiles,
 * which already have a direct path via offers.created_by.
 *
 * Checked before shipping: no query anywhere embeds profiles from offers
 * (or the reverse) — `offers` is new in this migration, and both reads of
 * it select plain columns only. If one is ever added it needs an explicit
 * hint, e.g. `profiles!offers_created_by_fkey ( … )`.
 */
create table if not exists offer_dismissals (
  offer_id uuid not null references offers (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (offer_id, profile_id)
);

alter table offers enable row level security;
alter table offer_dismissals enable row level security;

/*
 * Targeting is enforced HERE, not in the component (SPEC.md §5, and the
 * house rule that access control lives in the database). An offer aimed at
 * Founding Members is a discount: if the only thing standing between it and
 * everyone else were a React condition, the terms would be readable by
 * anyone who opened the network tab, and "members only" would be a
 * decoration.
 *
 * Live means: active, inside its window, and the member holds one of the
 * listed badges or one of the listed tiers with usable access.
 */
drop policy if exists "offers visible to targeted members" on offers;
create policy "offers visible to targeted members" on offers
  for select using (
    active
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
    and (
      exists (
        select 1 from member_badges mb
        where mb.profile_id = auth.uid()
          and mb.badge_key = any (offers.audience_badges)
      )
      or exists (
        select 1 from memberships m
        where m.profile_id = auth.uid()
          and m.status in ('active', 'past_due')
          and m.tier = any (offers.audience_tiers)
      )
    )
  );

-- Members manage only their own dismissals, and can never un-dismiss
-- someone else's or read who else closed what.
drop policy if exists "own dismissals read" on offer_dismissals;
create policy "own dismissals read" on offer_dismissals
  for select using (auth.uid() = profile_id);

drop policy if exists "own dismissals write" on offer_dismissals;
create policy "own dismissals write" on offer_dismissals
  for insert with check (auth.uid() = profile_id);

-- Admin reads and writes run through the service role, as everywhere else
-- in the admin portal.
