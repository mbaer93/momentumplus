-- CE hours accept whole numbers or decimals (e.g. 1.25) — two decimal places.
alter table courses
  alter column ce_hours type numeric(6,2);
