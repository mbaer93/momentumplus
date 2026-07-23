-- ============================================================================
-- Momentum+ migration 0051 (Sierra, 2026-07-23):
-- 1) Allow the 'aspire' program (Aspire2Achieve Growth — monthly drop-in
--    accountability sessions, same treatment as rooted_focus).
-- 2) Bulk-recategorize existing sessions into the new taxonomy (Matt chose
--    bulk over hand-editing). Rooted Focus rows become Productivity
--    Sessions; legacy educational categories fold into Monthly Educational
--    Session; Networking folds into Bonus Sessions.
-- ============================================================================

alter table sessions drop constraint if exists sessions_program_check;
alter table sessions
  add constraint sessions_program_check
  check (program in ('standard', 'rooted_focus', 'aspire'));

update sessions set category = 'Productivity Session'
  where program = 'rooted_focus';

update sessions set category = 'Monthly Educational Session'
  where program = 'standard'
    and category in ('Leadership', 'Wellness', 'Business');

update sessions set category = 'Bonus Sessions'
  where program = 'standard'
    and category = 'Networking';
