import { createHmac } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Zoom recording pipeline (SPEC.md §4): when a cloud recording finishes,
 * Zoom calls this webhook → we hand the download URL to Mux → a Library
 * video row is created UNPUBLISHED and admins get a bell notification to
 * review + publish (publishing then notifies members via the existing
 * recording_ready fan-out). Rooted Focus sessions are skipped — they never
 * go in the library.
 *
 * Setup (Zoom App Marketplace → your Server-to-Server app → Feature →
 * Event Subscriptions): subscribe to "All Recordings have completed",
 * point it at /api/webhooks/zoom, and put the app's Secret Token in the
 * ZOOM_WEBHOOK_SECRET_TOKEN env var.
 */

interface RecordingFile {
  file_type?: string;
  file_size?: number;
  recording_type?: string;
  download_url?: string;
  status?: string;
}

function hmacHex(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export async function POST(req: NextRequest) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!secret) {
    return NextResponse.json(
      { error: "ZOOM_WEBHOOK_SECRET_TOKEN is not configured" },
      { status: 503 },
    );
  }

  const raw = await req.text();
  let body: {
    event?: string;
    download_token?: string;
    payload?: {
      plainToken?: string;
      object?: {
        id?: number | string;
        topic?: string;
        recording_files?: RecordingFile[];
      };
    };
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  // Zoom's endpoint validation handshake.
  if (body.event === "endpoint.url_validation" && body.payload?.plainToken) {
    return NextResponse.json({
      plainToken: body.payload.plainToken,
      encryptedToken: hmacHex(secret, body.payload.plainToken),
    });
  }

  // Signature check on real events.
  const ts = req.headers.get("x-zm-request-timestamp") ?? "";
  const sig = req.headers.get("x-zm-signature") ?? "";
  const expected = `v0=${hmacHex(secret, `v0:${ts}:${raw}`)}`;
  if (!sig || sig !== expected) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  if (body.event !== "recording.completed") {
    return NextResponse.json({ ok: true, ignored: body.event });
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const meetingId = String(body.payload?.object?.id ?? "");
  const files = body.payload?.object?.recording_files ?? [];
  if (!meetingId || files.length === 0) {
    return NextResponse.json({ ok: true, note: "nothing to ingest" });
  }

  const admin = createServiceClient();
  const { data: session } = await admin
    .from("sessions")
    .select("id, title, category, min_access, program")
    .eq("zoom_meeting_id", meetingId)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ ok: true, note: "no matching session" });
  }

  const { ingestSessionRecording } = await import("@/lib/zoom-recordings");
  const result = await ingestSessionRecording(
    admin,
    session as unknown as import("@/lib/zoom-recordings").IngestSession,
    files,
    body.download_token ?? null,
  );
  if (!result.ok && result.status.startsWith("Mux ingest failed")) {
    // Non-200 → Zoom retries the webhook later.
    return NextResponse.json({ error: result.status }, { status: 502 });
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.status }, { status: 500 });
  }
  return NextResponse.json({ ok: true, note: result.status });
}
