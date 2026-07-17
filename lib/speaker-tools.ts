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
}

export async function getSpeakerForUser(
  userId: string,
): Promise<OwnSpeaker | null> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  const { data } = await createServiceClient()
    .from("speakers")
    .select(
      "id, name, title, bio, industries, headshot_url, resource_id, expires_at, archived_at",
    )
    .eq("profile_id", userId)
    .maybeSingle();
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
