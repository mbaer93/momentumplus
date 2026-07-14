import Link from "next/link";
import { AdminIcon, SessionsIcon, ChevronRightIcon } from "@/components/icons";

// Phase 2 ships admin session management. The full admin portal (content,
// members, announcements, sponsors) with its purple chrome lands in Phase 7.
export default function AdminPage() {
  return (
    <div className="admin-pad">
      <div className="section-header">
        <div>
          <h2>Admin Panel</h2>
          <p>Manage the Momentum+ portal</p>
        </div>
      </div>

      <div className="admin-hint">
        Phase 2 includes session management. Member management, the announcement
        composer, sponsors, and content tools arrive with the full admin portal
        in Phase 7.
      </div>

      <div className="two-col">
        <Link href="/admin/sessions" className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div className="stat-icon purple">
              <SessionsIcon size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                Manage Sessions
              </div>
              <div style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
                Create, edit, publish (creates the Zoom meeting), and remove
                sessions.
              </div>
            </div>
            <ChevronRightIcon size={12} />
          </div>
        </Link>

        <div className="card" style={{ padding: 20, opacity: 0.6 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div className="stat-icon gold">
              <AdminIcon size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                Members, content &amp; sponsors
              </div>
              <div style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
                Coming in Phase 7.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
