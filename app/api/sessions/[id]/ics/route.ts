import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/sessions/queries";
import { isDropInProgram } from "@/lib/programs";
import { buildIcs } from "@/lib/ics";
import { rruleFor } from "@/lib/recurrence";

// "Add to Calendar" — returns an .ics for the session. RLS (or placeholder
// visibility) already restricts which sessions can be fetched.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession(params.id);
  if (!session) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Only enrolled members may add a session to their calendar; drop-in
  // programs (Rooted Focus / Aspire) need no enrollment (Matt, 2026-08-05).
  // This also stops the Zoom link from leaking via a crafted .ics URL.
  if (!session.isEnrolled && !isDropInProgram(session.program)) {
    return new NextResponse("Enroll to add this session to your calendar", {
      status: 403,
    });
  }

  const joinUrl = session.zoomJoinUrl;
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
      ? rruleFor(session.recurrence, session.recurrenceUntil, session.startsAt)
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
