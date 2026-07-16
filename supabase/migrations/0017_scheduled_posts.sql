-- Scheduled community posts: admins compose announcements ahead of time;
-- the cron posts them to the chosen chat channel at send_at as
-- "Momentum+ Team". Admin-only rows; the cron uses the service role.
create table if not exists scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'announcements',
  body text not null,
  send_at timestamptz not null,
  sent_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table scheduled_posts enable row level security;

create policy "scheduled_posts: admin all" on scheduled_posts
  for all using (is_admin()) with check (is_admin());

create index if not exists scheduled_posts_due_idx
  on scheduled_posts (send_at) where sent_at is null;
