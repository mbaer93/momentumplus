-- Resource cards carry an image: uploaded by an admin or pulled from the
-- resource link's Open Graph preview. Stored in the public resource-images
-- bucket; this column holds the display URL.
alter table resources
  add column if not exists image_url text;
