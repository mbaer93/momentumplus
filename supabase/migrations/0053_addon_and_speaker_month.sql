-- ============================================================================
-- Momentum+ migration 0053 (Matt, 2026-07-24):
-- 1) New 'addon' program — Add-on Sessions (speaker-led extras like the
--    monthly "AI use in business" series). They live on the Sessions tab
--    with normal enrollment, can be recurring or one-off, and are recorded.
-- 2) Speaker-of-the-month fields: each Momentum+ speaker is assigned one
--    calendar month (YYYY-MM); TSLS Main Speakers (first months of the
--    season) are flagged so the platform knows they are unpaid — everyone
--    else earns 15% of that month's monthly-equivalent membership revenue.
-- ============================================================================

alter table sessions drop constraint if exists sessions_program_check;
alter table sessions
  add constraint sessions_program_check
  check (program in ('standard', 'rooted_focus', 'aspire', 'addon'));

alter table speakers
  add column if not exists tsls_main_speaker boolean not null default false,
  add column if not exists speaker_month text
    check (speaker_month is null or speaker_month ~ '^\d{4}-(0[1-9]|1[0-2])$');

comment on column speakers.speaker_month is
  'Momentum+ speaker-of-the-month assignment, YYYY-MM (ET). Drives the Studio member-count/earnings card.';
comment on column speakers.tsls_main_speaker is
  'TSLS Main Speakers (event mainstage) are unpaid on Momentum+ — hides the earnings line, keeps the member-count card.';
