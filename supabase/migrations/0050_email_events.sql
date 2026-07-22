-- ============================================================================
-- Momentum+ migration 0050: email delivery journal
-- SendGrid's Event Webhook reports what happened to each auth email
-- (delivered, opened, bounced, blocked, dropped, spam). Rows land here so
-- admins can answer "did the invite actually reach them?" from the portal
-- instead of the SendGrid dashboard (whose activity feed only keeps ~3
-- days). Service-role only: written by the webhook, read by admin pages.
-- ============================================================================

create table email_events (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  event text not null, -- delivered | open | bounce | blocked | dropped | spamreport
  reason text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index email_events_email_idx on email_events (email, occurred_at desc);
create index email_events_time_idx on email_events (occurred_at desc);

alter table email_events enable row level security;
-- No member policies on purpose — delivery data includes email addresses.
