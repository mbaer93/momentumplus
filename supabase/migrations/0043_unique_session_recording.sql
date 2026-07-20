-- One Library video per session, enforced by the DATABASE. The webhook,
-- the hourly recording poller, and the admin "Get recording" button all
-- guarded with check-then-insert, which races when two paths run in the
-- same moment (double Mux asset, double Library row, double notification).
--
-- Multiple NULL session_ids are allowed (manual uploads are unaffected —
-- UNIQUE treats NULLs as distinct).

-- Remove any duplicates that already slipped in: keep one row per session
-- (lowest id — videos has no created_at column, and id is deterministic).
delete from videos v
using videos keep
where v.session_id is not null
  and keep.session_id = v.session_id
  and keep.id < v.id;

alter table videos
  add constraint videos_session_id_unique unique (session_id);
