-- New member tier: sponsor — auto-applied to the user who runs a sponsor
-- page (Matt, 2026-07-18). Access is Pro-equivalent; gating and data
-- conversion live in 0038.
--
-- RUN THIS ALONE, BEFORE 0038. Postgres refuses to USE a new enum value in
-- the same transaction that adds it, so this must be its own SQL-editor run.
alter type access_tier add value if not exists 'sponsor';
