-- Engagement badges: the member's own opt-out (Matt, 2026-08-18).
--
-- Badges appear on a member's profile, next to their name in the directory,
-- and on their chat messages. Matt's rule: "Members should be able to select
-- if they want to hide it."
--
-- Opt-OUT, not opt-in: a badge nobody can see by default gamifies nothing.
-- The switch hides them from other members; a member always sees their own,
-- because their own progress is the part that is useful to them.

alter table profiles
  add column if not exists hide_badges boolean not null default false;

comment on column profiles.hide_badges is
  'Member chose to hide their engagement badges from other members. Their own profile still shows them.';

-- Only ever read as a filter over a set of members being rendered.
create index if not exists profiles_hide_badges_idx
  on profiles (hide_badges) where hide_badges;
