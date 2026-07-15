import {
  CalendarView,
  type CalendarEvent,
} from "@/components/calendar/CalendarView";
import { AdminAddChip } from "@/components/admin/AdminChips";
import { requireMember } from "@/lib/current-member";
import { listSessions } from "@/lib/sessions/queries";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const member = await requireMember();
  const sessions = await listSessions();

  const events: CalendarEvent[] = sessions
    .filter((s) => s.startsAt)
    .map((s) => ({
      id: s.id,
      slug: s.slug,
      title: s.title,
      startsAt: s.startsAt,
      category: s.category,
      speakerName: s.speaker.name,
      isEnrolled: s.isEnrolled,
    }));

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
      <CalendarView events={events} />
    </div>
  );
}
