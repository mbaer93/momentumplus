import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/sessions/queries";
import { buildIcs } from "@/lib/ics";

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

  const ics = buildIcs({
    uid: `session-${session.id}@momentumplus`,
    title: `Momentum+ · ${session.title}`,
    description: `${session.description}\n\nSpeaker: ${session.speaker.name}`,
    location: session.zoomJoinUrl ?? "Momentum+ (online)",
    url: session.zoomJoinUrl ?? undefined,
    start: new Date(session.startsAt),
    durationMin: session.durationMin,
    organizerName: "Momentum+",
  });

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${session.slug}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
