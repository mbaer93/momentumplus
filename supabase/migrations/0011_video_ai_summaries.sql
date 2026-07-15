-- AI summaries for standalone Library uploads (not just session recordings).
-- The upload pipeline stores the Mux asset id; the summaries cron requests
-- Mux auto-captions, pulls the transcript, and writes a summary keyed to the
-- video. ai_summaries rows now attach to a session OR a video.

alter table videos
  add column if not exists mux_asset_id text;

alter table ai_summaries
  add column if not exists video_id uuid unique references videos(id) on delete cascade;

alter table ai_summaries
  alter column session_id drop not null;

create policy "ai_summaries: read via video"
  on ai_summaries for select
  using (
    video_id is not null and exists (
      select 1 from videos v
      where v.id = video_id
        and v.published_at is not null
        and can_view(v.min_access)
    )
  );
