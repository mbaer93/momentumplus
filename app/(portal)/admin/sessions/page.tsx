import Link from "next/link";
import { listSessions } from "@/lib/sessions/queries";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { dateLabel, timeLabel } from "@/lib/sessions/view";
import { SessionRowActions } from "@/components/admin/SessionRowActions";

export const dynamic = "force-dynamic";

export default async function AdminSessionsPage() {
  const sessions = await listSessions();

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
                  {s.zoomMeetingId ? (
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
                      hasMeeting={Boolean(s.zoomMeetingId)}
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
