import {
  CalendarView,
  type CalendarEvent,
} from "@/components/calendar/CalendarView";
import { AdminAddChip } from "@/components/admin/AdminChips";
import { requireMember } from "@/lib/current-member";
import { BodyAd } from "@/components/sponsors/BodyAd";
import { expandOccurrences } from "@/lib/recurrence";
import { listSessions } from "@/lib/sessions/queries";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const member = await requireMember();
  const sessions = await listSessions();

  // Recurring series (Rooted Focus) paint every occurrence over the next
  // few months, not just the next one.
  const now = Date.now();
  const horizon = now + 120 * 24 * 60 * 60 * 1000;
  const events: CalendarEvent[] = sessions
    .filter((s) => s.startsAt)
    // Drafts and archived sessions never land on a member's calendar;
    // admins manage those from Admin → Sessions, not here.
    .filter(
      (s) =>
        (s.status !== "draft" && s.status !== "archived") || member.isAdmin,
    )
    .flatMap((s) => {
      const starts = s.recurrence
        ? expandOccurrences(
            s.startsAt,
            s.recurrence,
            s.recurrenceUntil,
            now - 24 * 60 * 60 * 1000,
            horizon,
          )
        : [s.startsAt];
      return starts.map((startsAt, i) => ({
        id: i === 0 ? s.id : `${s.id}:${i}`,
        slug: s.slug,
        title: s.title,
        startsAt,
        category: s.category,
        program: s.program,
        speakerName: s.speaker.name,
        isEnrolled: s.isEnrolled,
      }));
    });

  return (
    <div className="calendar-pad">
      <div className="section-header" style={{ marginBottom: 0 }}>
        <div>
          <h2>Calendar</h2>
          <p>Your session schedule and upcoming events</p>
        </div>
        {member.isAdmin && (
          <AdminAddChip href="/admin/sessions/new" label="New session" />
        )}
      </div>
      <BodyAd variant="banner" />
      <CalendarView events={events} />
    </div>
  );
}
