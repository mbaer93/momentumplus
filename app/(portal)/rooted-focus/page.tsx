import Link from "next/link";
import { listSessions } from "@/lib/sessions/queries";
import { SessionsBrowser } from "@/components/sessions/SessionsBrowser";
import { AdminAddChip } from "@/components/admin/AdminChips";
import { requireMember } from "@/lib/current-member";

export const dynamic = "force-dynamic";

export const metadata = { title: "Rooted Focus | Momentum+" };

/*
 * Rooted Focus: 90-minute structured co-working sessions led by the SLC
 * team. Same browsing experience as Sessions, scoped to the rooted_focus
 * program, with the session rhythm explained up top. Enrolling adds the
 * whole recurring series to the member's calendar (RRULE in the .ics and
 * Google Calendar links).
 */

const RHYTHM: { step: string; detail: string }[] = [
  {
    step: "Ground In",
    detail: "Share what you're working on with the group. Name your focus.",
  },
  {
    step: "Get to Work",
    detail: "Cameras off. Mics off. You dive in. We all do.",
  },
  {
    step: "Check In & Reset",
    detail:
      "At halftime, we regroup to share progress and set goals for round two.",
  },
  {
    step: "Finish Strong",
    detail: "Back to focused work. No distractions, no excuses.",
  },
  {
    step: "Celebrate & Wrap",
    detail:
      "We close with a quick win review and send you back into your day with momentum.",
  },
];

export default async function RootedFocusPage() {
  const member = await requireMember();
  const sessions = (await listSessions()).filter(
    (s) => s.program === "rooted_focus",
  );

  return (
    <div className="sessions-pad">
      <div className="section-header">
        <div>
          <h2>Rooted Focus</h2>
          <p>
            90 minutes of structured, distraction-free work — together, via
            Zoom
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {member.isAdmin && (
            <AdminAddChip href="/admin/sessions/new" label="New session" />
          )}
          <Link href="/calendar" className="btn-primary">
            View Calendar
          </Link>
        </div>
      </div>

      {/* The rhythm: five phases, every session. */}
      <div
        className="admin-form"
        style={{ maxWidth: "none", marginBottom: 18, padding: "16px 18px" }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: "var(--gold)",
            fontWeight: 600,
            marginBottom: 10,
          }}
        >
          How every session runs
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: 14,
          }}
        >
          {RHYTHM.map((r, i) => (
            <div key={r.step}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>
                {i + 1}. {r.step}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--mid-gray)", lineHeight: 1.5 }}>
                {r.detail}
              </div>
            </div>
          ))}
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="sessions-empty" style={{ marginTop: 8 }}>
          Rooted Focus sessions will appear here as they&apos;re scheduled.
        </div>
      ) : (
        <SessionsBrowser sessions={sessions} isAdmin={member.isAdmin} />
      )}
    </div>
  );
}
