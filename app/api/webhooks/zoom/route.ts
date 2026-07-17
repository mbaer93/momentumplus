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
  if ((session as { program?: string }).program === "rooted_focus") {
    return NextResponse.json({ ok: true, note: "rooted focus — not archived" });
  }

  // One recording per session — re-deliveries and multi-file events must
  // not create duplicates.
  const { data: existing } = await admin
    .from("videos")
    .select("id")
    .eq("session_id", session.id)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, note: "video already exists" });
  }

  // Best MP4: prefer the speaker-view screen share, else the largest file.
  const mp4s = files.filter(
    (f) => f.file_type === "MP4" && f.download_url && f.status !== "processing",
  );
  const best =
    mp4s.find((f) => f.recording_type === "shared_screen_with_speaker_view") ??
    mp4s.sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0))[0];
  if (!best?.download_url) {
    return NextResponse.json({ ok: true, note: "no MP4 in this delivery" });
  }

  const inputUrl = body.download_token
    ? `${best.download_url}?access_token=${body.download_token}`
    : best.download_url;

  let assetId: string;
  try {
    const { createMuxAssetFromUrl } = await import("@/lib/mux");
    const asset = await createMuxAssetFromUrl(inputUrl);
    assetId = asset.id;
  } catch (e) {
    // Non-200 → Zoom retries the webhook later.
    return NextResponse.json(
      { error: `Mux ingest failed: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  // Unpublished on purpose: an admin reviews and publishes with one click
  // (which fires the members' recording_ready notification).
  const { error: insertError } = await admin.from("videos").insert({
    title: session.title,
    category: session.category,
    session_id: session.id,
    mux_asset_id: assetId,
    min_access: session.min_access,
    published_at: null,
  });
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Tell the admins there's a recording to review.
  const { data: admins } = await admin
    .from("profiles")
    .select("id")
    .not("admin_role", "is", null);
  if (admins?.length) {
    await admin.from("notifications").insert(
      admins.map((a) => ({
        profile_id: a.id,
        kind: "platform",
        title: "Session recording ready to review",
        body: `"${session.title}" imported from Zoom — review and publish it.`,
        link: "/admin/videos",
      })),
    );
  }

  return NextResponse.json({ ok: true, assetId });
}
