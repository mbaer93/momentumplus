import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { PrefKey } from "@/lib/notifications";

/*
 * Content fan-out to the in-app bell: new sessions, recordings, resources.
 * Honors each member's in_app preference for the matching key and dedupes
 * on (kind, link) per member, so a re-publish never re-notifies. In-app
 * only — the bell is cheap attention; email for these would be spam.
 * Best-effort: never throws (a notification must never break publishing).
 */
export async function notifyMembersInApp(input: {
  key: Extract<PrefKey, "session_new" | "recording_ready" | "resource_new">;
  title: string;
  body: string;
  link: string;
}): Promise<void> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const admin = createServiceClient();

    const [{ data: memberships }, { data: prefs }, { data: already }] =
      await Promise.all([
        admin
          .from("memberships")
          .select("profile_id")
          .in("status", ["active", "past_due"]),
        admin
          .from("notification_prefs")
          .select("profile_id, in_app")
          .eq("key", input.key),
        admin
          .from("notifications")
          .select("profile_id")
          .eq("kind", input.key)
          .eq("link", input.link),
      ]);

    const optedOut = new Set(
      (prefs ?? []).filter((p) => p.in_app === false).map((p) => p.profile_id),
    );
    const done = new Set((already ?? []).map((n) => n.profile_id));
    const targets = Array.from(
      new Set((memberships ?? []).map((m) => m.profile_id as string)),
    ).filter((id) => !optedOut.has(id) && !done.has(id));

    if (targets.length === 0) return;
    await admin.from("notifications").insert(
      targets.map((profile_id) => ({
        profile_id,
        kind: input.key,
        title: input.title,
        body: input.body || null,
        link: input.link,
      })),
    );
  } catch {
    // Silent by design.
  }
}
