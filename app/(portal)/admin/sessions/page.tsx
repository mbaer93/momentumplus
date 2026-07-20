import Link from "next/link";
import { listSessions } from "@/lib/sessions/queries";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { dateLabel, timeLabel } from "@/lib/sessions/view";
import { SessionRowActions } from "@/components/admin/SessionRowActions";

export const dynamic = "force-dynamic";

export default async function AdminSessionsPage() {
  const sessions = await listSessions();

  // The member-level query CANNOT see the zoom columns (locked by column
  // grants in migration 0020, attached per-session for enrolled viewers
  // only) — so this table read zoomMeetingId as null and showed "Not yet"
  // for EVERY session, even ones with live meetings. Ask the service role
  // for the truth.
  const zoomBySession = new Set<string>();
  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data } = await createServiceClient()
      .from("sessions")
      .select("id")
      .not("zoom_meeting_id", "is", null);
    for (const r of data ?? []) zoomBySession.add(r.id as string);
  }
  const hasMeeting = (id: string) =>
    isSupabaseConfigured()
      ? zoomBySession.has(id)
      : sessions.some((s) => s.id === id && Boolean(s.zoomMeetingId));

  return (
    <div className="admin-pad">
      <div className="section-header">
        <div>
          <h2>Manage Sessions</h2>
          <p>Create, edit, publish, and remove sessions</p>
        </div>
        <Link href="/admin/sessions/new" className="btn-purple">
          New session
        </Link>
      </div>

      {!isSupabaseConfigured() && (
        <div className="admin-hint">
          Preview mode: showing placeholder sessions. Connect Supabase to manage
          real data — create, edit, publish (creates the Zoom meeting), and
          delete all persist once configured.
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Session</th>
              <th>Date</th>
              <th>Status</th>
              <th>Enrolled</th>
              <th>Zoom</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="admin-row-title">
                    <Link href={`/sessions/${s.slug}`}>{s.title}</Link>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--mid-gray)" }}>
                    {s.speaker.name} · {s.category}
                  </div>
                </td>
                <td>
                  {s.startsAt ? (
                    <>
                      {dateLabel(s.startsAt)}
                      <div style={{ fontSize: 12, color: "var(--mid-gray)" }}>
                        {timeLabel(s.startsAt)}
                      </div>
                    </>
                  ) : (
                    <span style={{ color: "var(--mid-gray)" }}>—</span>
                  )}
                </td>
                <td>
                  <span className={`admin-status ${s.status}`}>{s.status}</span>
                </td>
                <td>{s.enrolledCount}</td>
                <td>
                  {hasMeeting(s.id) ? (
                    <span style={{ color: "var(--accent-green)", fontSize: 12 }}>
                      Created
                    </span>
                  ) : (
                    <span style={{ color: "var(--mid-gray)", fontSize: 12 }}>
                      Not yet
                    </span>
                  )}
                </td>
                <td>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <SessionRowActions
                      sessionId={s.id}
                      hasMeeting={hasMeeting(s.id)}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
