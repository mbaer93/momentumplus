-- Sessions can be cancelled (audit batch F). Before this, a future-dated
-- session an admin wanted to call off had no honest state: it kept showing
-- "Upcoming" with a live Enroll button, and clicking it surfaced a raw RLS
-- error. Enum append is safe (no reorder).
alter type session_status add value if not exists 'cancelled';
