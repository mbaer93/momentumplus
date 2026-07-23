import type { createServiceClient } from "@/lib/supabase/admin";
import type { ZoomRecordingFile } from "@/lib/zoom";

/*
 * Shared Zoom-recording ingest: pick the best MP4, hand it to Mux, create
 * the (unpublished) Library video linked to the session, and tell admins
 * there's a recording to review. Used by BOTH delivery paths:
 *   - the Zoom webhook (instant, but requires one-time setup in the Zoom
 *     App Marketplace dashboard), and
 *   - the attendance cron's poller (no Zoom dashboard setup at all — it
 *     asks the Zoom API for recordings of recently-ended sessions).
 * Either path may run first; the existing-video check makes them safe
 * together.
 */

export interface IngestSession {
  id: string;
  title: string;
  category: string | null;
  min_access: string | null;
  program?: string | null;
}

export async function ingestSessionRecording(
  admin: ReturnType<typeof createServiceClient>,
  session: IngestSession,
  files: ZoomRecordingFile[],
  /** Token appended to the download URL (webhook download_token or an S2S
      access token — both authorize Zoom recording downloads). */
  accessToken?: string | null,
): Promise<{ ok: boolean; status: string }> {
  if (session.program === "rooted_focus") {
    return { ok: true, status: "rooted focus — not archived" };
  }

  // One recording per session — webhook re-deliveries, multi-file events,
  // and the poller must not create duplicates.
  const { data: existing } = await admin
    .from("videos")
    .select("id")
    .eq("session_id", session.id)
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: true, status: "video already exists" };

  // Best MP4: prefer the speaker-view screen share, else the largest file.
  const mp4s = files.filter(
    (f) => f.file_type === "MP4" && f.download_url && f.status !== "processing",
  );
  const best =
    mp4s.find((f) => f.recording_type === "shared_screen_with_speaker_view") ??
    mp4s.sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0))[0];
  if (!best?.download_url) {
    return { ok: false, status: "no finished MP4 yet" };
  }

  const inputUrl = accessToken
    ? `${best.download_url}?access_token=${accessToken}`
    : best.download_url;

  let assetId: string;
  try {
    const { createMuxAssetFromUrl } = await import("@/lib/mux");
    const asset = await createMuxAssetFromUrl(inputUrl);
    assetId = asset.id;
  } catch (e) {
    return { ok: false, status: `Mux ingest failed: ${(e as Error).message}` };
  }

  // Unpublished at first — it AUTO-PUBLISHES (summaries cron) once the
  // video is playable AND the AI summary exists, never earlier. Admins can
  // still edit or publish sooner from Admin → Library.
  // Upsert on session_id (unique since migration 0043): if the webhook and
  // the poller race past the check above, one insert wins and the other
  // becomes a no-op instead of a duplicate Library row.
  const row = {
    title: session.title,
    category: session.category,
    session_id: session.id,
    mux_asset_id: assetId,
    min_access: session.min_access,
    published_at: null,
  };
  let { error: insertError } = await admin
    .from("videos")
    .upsert(row, { onConflict: "session_id", ignoreDuplicates: true });
  if (insertError && /no unique|constraint/i.test(insertError.message)) {
    // Pre-migration-0043 fallback: plain insert (the check above still
    // covers the common path).
    ({ error: insertError } = await admin.from("videos").insert(row));
  }
  if (insertError) return { ok: false, status: insertError.message };

  // Tell the admins there's a recording to review.
  try {
    const { listAdminProfileIds } = await import("@/lib/engagement-notify");
    const adminIds = await listAdminProfileIds();
    if (adminIds.length) {
      await admin.from("notifications").insert(
        adminIds.map((id) => ({
          profile_id: id,
          kind: "platform",
          title: "Session recording imported",
          body: `"${session.title}" imported from Zoom — it publishes to members automatically once the video and AI summary are ready.`,
          link: "/admin/videos",
        })),
      );
    }
  } catch {
    // Notification is best-effort — the video row is what matters.
  }

  return { ok: true, status: `ingested (${assetId})` };
}
