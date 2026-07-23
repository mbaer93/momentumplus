-- Sponsor-invite prefill (Matt, 2026-07-23): the TSLS Companion is the
-- single front door and the source of truth for a sponsor's details. When
-- an admin enters a sponsor there, TSLS pushes the business info onto a
-- Momentum+ sponsor invite so the rep's onboarding form is prefilled —
-- "enter once, appears in both" — and they just confirm and publish.
--
-- These live on sponsor_invites (service-role only, never member-facing),
-- so nothing surfaces to members until the rep completes onboarding and the
-- team activates the listing. Text-only; the logo stays a manual upload.

alter table public.sponsor_invites
  add column if not exists tagline text,
  add column if not exists description text,
  add column if not exists website text;
