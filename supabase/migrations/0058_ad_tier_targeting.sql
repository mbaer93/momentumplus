-- ============================================================================
-- Momentum+ migration 0058: tier-targeted ads (Matt, 2026-07-28: "I also
-- want to create ads specific to the tier of the member.")
--
-- An ads row gains an optional list of member-type slugs. Null or empty
-- means what it always meant: every member sees it. When set, only members
-- whose tier is in the list get the row — enforced here in RLS, so the
-- targeting can't be bypassed by a cached page or a future reader that
-- forgets to filter. Admins keep reading everything (the manager needs the
-- full list, and admins preview all placements).
--
-- Slugs are stored as plain text, matching memberships.tier — deliberately
-- no foreign key, same reasoning as memberships itself: an ad targeting a
-- tier that later gets archived should degrade to "nobody sees it", not
-- block the archive.
-- ============================================================================

alter table ads add column if not exists tiers text[];

drop policy if exists "ads: read live" on ads;
create policy "ads: read live" on ads
  for select using (
    is_admin()
    or (
      auth.uid() is not null
      and active
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at > now())
      and (
        tiers is null
        or tiers = '{}'
        or tiers && current_user_tiers()
      )
    )
  );
