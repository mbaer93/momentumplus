-- Per-sponsor VIP ticket override (Matt, 2026-07-18): a specific sponsor
-- can be granted a custom ticket count that replaces their tier's default
-- allotment. NULL = use the tier default from app_settings.
alter table sponsors
  add column if not exists ticket_override integer;
