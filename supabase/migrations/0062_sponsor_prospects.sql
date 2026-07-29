-- 2026 sponsorship catalog groundwork (Matt, 2026-07-29).
--
-- 1) New tiers from the 2026 package sheets: Event Program Sponsor plus the
--    three in-kind Media Partnership levels. The tier CHECK from 0042
--    predates them — recreate it.
-- 2) Prospects: interest-form submissions live in the sponsors table as
--    prospect rows — hidden from every member surface until an admin
--    confirms the sponsorship. Contact + notes columns hold what the form
--    captured. NO emails are sent to prospects by anything in the app.
-- 3) Seed the per-tier VIP ticket defaults from the sheets into
--    app_settings — counts the admin already set always win.

alter table public.sponsors
  drop constraint if exists sponsors_tier_check;

alter table public.sponsors
  add constraint sponsors_tier_check check (tier in (
    'host', 'momentum_plus', 'title', 'platinum', 'gold', 'lunch',
    'happy_hour', 'breakfast', 'silver', 'coffee_break', 'event_program',
    'community', 'strategic_media', 'regional_media', 'community_media',
    'partner'
  ));

alter table public.sponsors
  add column if not exists prospect boolean not null default false,
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists notes text;

-- Members never see prospect rows, even without the app-side filter.
-- (Admin UIs read through the service role, which bypasses RLS.)
drop policy if exists "sponsors: read for members" on public.sponsors;
create policy "sponsors: read for members"
  on public.sponsors for select
  using (
    is_admin()
    or (
      coalesce(prospect, false) = false
      and exists (
        select 1 from memberships m
        where m.profile_id = auth.uid()
          and m.status = 'active'
          and (m.access_expires_at is null or m.access_expires_at > now())
      )
    )
  );

-- VIP ticket defaults per the 2026 sheets (title 10, momentum_plus 2,
-- platinum 5, lunch 3, happy_hour 3, gold 5, breakfast 2, silver 2,
-- coffee_break 2, event_program 2, community 1; media 5/2/1). The jsonb
-- merge keeps existing keys: `defaults || value` lets stored counts win.
insert into public.app_settings (key, value, updated_at)
values ('sponsor_ticket_counts', '{}'::jsonb, now())
on conflict (key) do nothing;

update public.app_settings
set value = '{
  "title": 10, "momentum_plus": 2, "platinum": 5, "lunch": 3,
  "happy_hour": 3, "gold": 5, "breakfast": 2, "silver": 2,
  "coffee_break": 2, "event_program": 2, "community": 1,
  "strategic_media": 5, "regional_media": 2, "community_media": 1
}'::jsonb || value,
    updated_at = now()
where key = 'sponsor_ticket_counts';
