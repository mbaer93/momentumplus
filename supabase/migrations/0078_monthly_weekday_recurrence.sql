-- Monthly-by-weekday recurrence (Matt, 2026-08-06): A2A Growth repeats on
-- the 4th Monday of every month. The pattern (which weekday, which week)
-- comes from the series start date; 'monthly' stays the same-date rule.

alter table sessions drop constraint if exists sessions_recurrence_check;
alter table sessions
  add constraint sessions_recurrence_check
  check (
    recurrence is null
    or recurrence in ('weekly', 'biweekly', 'monthly', 'monthly_weekday')
  );
