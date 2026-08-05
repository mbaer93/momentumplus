-- Scheduled announcements (Matt, 2026-08-05): Send Now and Schedule live in
-- the same composer. A scheduled announcement is an announcements row with
-- send_at set and sent_at NULL; the scheduled-posts cron delivers it when
-- due through the same fan-out as Send Now (community, in-app + push,
-- email, SMS), then stamps sent_at. The old scheduled_posts table (chat-only
-- posts) stays for anything already queued, but the admin UI now schedules
-- full announcements instead.

alter table announcements add column if not exists send_at timestamptz;

create index if not exists announcements_due_idx
  on announcements (send_at) where sent_at is null;
