import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/sessions/queries";
import { buildIcs } from "@/lib/ics";
import { rruleFor } from "@/lib/recurrence";

// "Add to Calendar" — returns an .ics for the session. RLS (or placeholder
// visibility) already restricts which sessions can be fetched.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getSession(params.id);
  if (!session) {
    return new NextResponse("Not found", { status: 404 });
  }

  // The Zoom link is for enrolled members only — everyone else gets a
  // calendar entry pointing back at the session page.
  const joinUrl = session.isEnrolled ? session.zoomJoinUrl : null;
  const ics = buildIcs({
    uid: `session-${session.id}@momentumplus`,
    title: `Momentum+ · ${session.title}`,
    description: `${session.description}\n\nSpeaker: ${session.speaker.name}`,
    location: joinUrl ?? "Momentum+ (online)",
    url: joinUrl ?? undefined,
    start: new Date(session.startsAt),
    durationMin: session.durationMin,
    organizerName: "Momentum+",
    // Recurring series (Rooted Focus): one import adds every occurrence.
    rrule: session.recurrence
      ? rruleFor(session.recurrence, session.recurrenceUntil)
      : undefined,
    // Pin to Eastern wall time so a 7 PM ET series stays 7 PM ET across
    // DST changes (sessions are an ET program).
    tzid: "America/New_York",
  });

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${session.slug}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
