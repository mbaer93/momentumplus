-- Education 2.0:
--   courses.ce_hours — admin-set continuing-education hours, printed on the
--     completion certificate
--   lessons carry rich content: reading text, an image, attached documents
--     ([{name,url}] in the education-media bucket), and an optional quiz
--     ({questions:[{q, options[], answer}]}) — answers never leave the server
-- Completion rules live in code: quiz lessons complete by passing; no-quiz
-- lessons complete automatically when opened. All lessons complete → the
-- member can print their certificate.

alter table courses
  add column if not exists ce_hours numeric(5,1);

alter table course_lessons
  add column if not exists content text,
  add column if not exists image_url text,
  add column if not exists documents jsonb not null default '[]'::jsonb,
  add column if not exists quiz jsonb;
