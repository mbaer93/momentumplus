-- Sponsor profile pages (Matt, 2026-07-17): every sponsor gets a full-page
-- profile like speakers. Adds the long-form "about" text the profile shows
-- under the logo/tagline.

alter table public.sponsors
  add column if not exists description text;
