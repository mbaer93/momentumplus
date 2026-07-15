-- Speakers: uploaded headshot (speaker-headshots bucket) + website link.
alter table speakers
  add column if not exists headshot_url text,
  add column if not exists website text;
