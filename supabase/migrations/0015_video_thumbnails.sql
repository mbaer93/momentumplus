-- Library video thumbnails: optional uploaded image that overrides the
-- default Mux screen grab shown on recording cards.
alter table public.videos
  add column if not exists thumbnail_url text;
