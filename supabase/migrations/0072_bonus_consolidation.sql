-- Consolidate the two "extra session" concepts into one (Matt, 2026-08-05).
--
-- Background: there were two overlapping ideas —
--   * the `addon` PROGRAM (a real speaker-led extra: own badge, recurring,
--     recorded to the Library), and
--   * a "Bonus Sessions" CATEGORY tag that could be stuck on a standard
--     session but carried no special behavior.
--
-- We keep the functional machinery (the `addon` program) and rename it,
-- member-facing, to "Bonus" everywhere in the app. Here we fold any legacy
-- standard sessions that were merely tagged with the "Bonus Sessions" (or
-- stray "Add-on Sessions") category into the addon program so there is a
-- single mechanism going forward. Idempotent — safe to re-run.

update sessions
set program = 'addon'
where program = 'standard'
  and category in ('Bonus Sessions', 'Add-on Sessions');
