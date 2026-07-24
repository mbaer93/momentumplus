import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sponsorActive } from "@/lib/sponsor-lifecycle";

/*
 * Speaker Studio support: resolve the speaker record owned by a signed-in
 * user, and the ownership guards behind every speaker self-service action.
 * A speaker whose season has ended (or who was archived) loses Studio
 * access along with member-facing visibility.
 */

export interface OwnSpeaker {
  id: string;
  name: string;
  title: string;
  bio: string;
  industries: string[];
  headshotUrl: string | null;
  resourceId: string | null;
  expiresAt: string | null;
  /** Speaker-of-the-month assignment ("YYYY-MM") — drives the Studio's
      members/earnings card. Null until an admin assigns a month. */
  speakerMonth: string | null;
  /** TSLS Main Speakers are unpaid — their card shows members, not money. */
  tslsMainSpeaker: boolean;
}

export async function getSpeakerForUser(
  userId: string,
): Promise<OwnSpeaker | null> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  const service = createServiceClient();
  let data: Record<string, unknown> | null = (
    await service
      .from("speakers")
      .select(
        "id, name, title, bio, industries, headshot_url, resource_id, expires_at, archived_at, speaker_month, tsls_main_speaker",
      )
      .eq("profile_id", userId)
      .maybeSingle()
  ).data;
  if (!data) {
    // Pre-migration-0053 fallback (no speaker-month columns yet).
    data = (
      await service
        .from("speakers")
        .select(
          "id, name, title, bio, industries, headshot_url, resource_id, expires_at, archived_at",
        )
        .eq("profile_id", userId)
        .maybeSingle()
    ).data;
  }
  if (!data) return null;
  if (
    !sponsorActive({
      archivedAt: (data.archived_at as string | null) ?? null,
      expiresAt: (data.expires_at as string | null) ?? null,
    })
  ) {
    return null;
  }
  return {
    id: data.id as string,
    name: (data.name as string) ?? "",
    title: (data.title as string) ?? "",
    bio: (data.bio as string) ?? "",
    industries: (data.industries as string[]) ?? [],
    headshotUrl: (data.headshot_url as string | null) ?? null,
    resourceId: (data.resource_id as string | null) ?? null,
    expiresAt: (data.expires_at as string | null) ?? null,
    speakerMonth: (data.speaker_month as string | null) ?? null,
    tslsMainSpeaker: Boolean(data.tsls_main_speaker),
  };
}

/** True when `userId` is the active speaker who owns `sessionId`. */
export async function speakerOwnsSession(
  userId: string,
  sessionId: string,
): Promise<{ ok: boolean; speakerId?: string }> {
  const speaker = await getSpeakerForUser(userId);
  if (!speaker) return { ok: false };
  const { data } = await createServiceClient()
    .from("sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("speaker_id", speaker.id)
    .maybeSingle();
  return data ? { ok: true, speakerId: speaker.id } : { ok: false };
}
