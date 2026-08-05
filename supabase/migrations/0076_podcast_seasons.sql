-- Podcast seasons (Matt, 2026-08-05): break Branching Out episodes into
-- seasons so members can find them easily. Admin-assigned — per episode in
-- the editor, or in bulk by date range. Episodes without a season appear
-- under "Extras" on the member tab once any season exists.

alter table podcast_episodes add column if not exists season int;

create index if not exists podcast_episodes_season_idx
  on podcast_episodes (season);
