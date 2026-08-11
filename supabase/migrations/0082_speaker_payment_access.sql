-- Per-speaker payment access (Matt, 2026-08-10).
--
-- Some Momentum+ speakers are not on the revenue share at all, and Matt
-- needs an explicit switch he can turn off per speaker. This is NOT the
-- same thing as tsls_main_speaker (0053):
--
--   tsls_main_speaker  describes WHO the speaker is — a TSLS mainstage
--                      speaker, whose Momentum+ month is part of their
--                      Summit engagement. The TSLS pull SETS it
--                      automatically from the lineup (role = 'main').
--   payment_access     is an admin DECISION about one speaker: may they
--                      use the payment feature at all. Nothing sets it
--                      but an admin in Admin -> Speakers; the TSLS bridge
--                      never writes it, and Speaker Studio self-service
--                      (which updates a fixed whitelist of profile fields)
--                      cannot reach it.
--
-- Both suppress money, so they can overlap but never contradict: earnings
-- are shown only when payment_access is true AND tsls_main_speaker is
-- false. Defaults to true so every existing speaker is unaffected.
--
-- Writes stay admin-only through the existing "speakers: admin write"
-- policy (RLS, migration 0001) — this column needs no policy of its own.

alter table speakers
  add column if not exists payment_access boolean not null default true;

comment on column speakers.payment_access is
  'Admin-only switch: false hides every earnings/revenue-share surface for this speaker (Studio card, admin month table, monthly report) and stops the server computing their share. Default true. Distinct from tsls_main_speaker, which marks TSLS mainstage speakers as unpaid.';
