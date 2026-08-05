-- Speaker contact email + invite wiring (Matt, 2026-08-05).
--
-- Speakers pulled from TSLS arrive as listings with no Momentum+ account.
-- Their email (from TSLS, or typed by an admin in the editor) is stored
-- here so the admin can later send login invites — one speaker at a time
-- or all at once. Distinct from profiles.email: contact_email is where we
-- REACH the person; profiles.email exists only once they have an account.

alter table speakers add column if not exists contact_email text;

-- Backfill from linked accounts so existing speakers show their email in
-- the admin editor immediately.
update speakers s
set contact_email = p.email
from profiles p
where s.profile_id = p.id
  and s.contact_email is null
  and p.email is not null;
