/*
 * PostgREST embed hints for the sessions <-> speakers relationship.
 *
 * Until migration 0087 there was exactly one path between the two tables
 * (sessions.speaker_id), so a bare speakers embed resolved on its own.
 * 0087 added session_speakers — a junction table whose primary key is
 * its two foreign keys — and PostgREST reads that shape as a SECOND
 * relationship (many-to-many). With two candidates, every unhinted embed
 * fails with PGRST201, "Could not embed because more than one relationship
 * was found for 'sessions' and 'speakers'".
 *
 * That is not a degraded read: listSessions throws on a query error (an
 * outage must not render as "no sessions yet"), so the ambiguity took down
 * every page that lists a session — including /admin.
 *
 * Naming the foreign key picks a path explicitly. Both constraint names are
 * Postgres defaults (`<table>_<column>_fkey`) generated from the unnamed
 * `references` clauses in 0001_init and 0087.
 *
 * Rule: never embed `speakers` without a hint, in either direction.
 * tests/session-speaker-embed.test.ts enforces this across the source tree —
 * an unhinted embed added later would fail the same way, and the symptom
 * (a blank error page) points nowhere near the query that caused it.
 */

/** sessions -> the single speaker in sessions.speaker_id (legacy column). */
export const SPEAKER_FROM_SESSION = "speakers!sessions_speaker_id_fkey";

/** session_speakers -> the speaker that lineup row names. */
export const SPEAKER_FROM_LINEUP = "speakers!session_speakers_speaker_id_fkey";
