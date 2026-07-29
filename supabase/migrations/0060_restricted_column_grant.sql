-- ============================================================================
-- Momentum+ migration 0060: grant the `restricted` column (hotfix).
--
-- Migration 0020 switched sessions to COLUMN-level grants (to keep Zoom
-- join credentials server-side), which means every later column must be
-- granted explicitly — 0030 did this for the Rooted Focus columns, 0059
-- forgot to for `restricted`. Result: any member select naming the column
-- failed with "permission denied for table sessions" and the portal's
-- session queries errored (Matt, 2026-07-29, /dashboard).
-- ============================================================================

grant select (restricted) on public.sessions to anon, authenticated;
