-- Admins can set a title (in relation to Momentum+/TSLS) that is shown next
-- to the Admin badge on their community chat messages.
alter table public.profiles
  add column if not exists admin_title text;
