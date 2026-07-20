import { canAccess } from "@/lib/access";
import { allRows } from "@/lib/db-utils";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { PrefKey } from "@/lib/notifications";
import type { AccessLevel, Tier } from "@/lib/types";

/**
 * Profile ids of everyone who can open the admin panel — an ACTIVE
 * admin-tier membership, the same rule requireAdmin() enforces. Admin
 * alerts (recording ready, testimonial waiting) must use this, not
 * profiles.admin_role: standard admins have no admin_role set, so filtering
 * on it silently drops them.
 */
export async function listAdminProfileIds(): Promise<string[]> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }
  const { data } = await createServiceClient()
    .from("memberships")
    .select("profile_id")
    .eq("tier", "admin")
    .eq("status", "active");
  return Array.from(new Set((data ?? []).map((r) => r.profile_id as string)));
}

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
  /** Gate the fan-out by the content's access level — a member whose tier
      can't open the recording must not get a bell that 404s on click. */
  minAccess?: AccessLevel | null;
}): Promise<void> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const admin = createServiceClient();

    // All three queries paged — plain selects cap at 1000 rows, which would
    // silently skip members (or worse, re-notify ones past the cap of the
    // dedupe query).
    const [{ rows: memberships }, { rows: prefs }, { rows: already }] =
      await Promise.all([
        allRows<{ profile_id: string; tier: string }>((from, to) =>
          admin
            .from("memberships")
            .select("profile_id, tier")
            .in("status", ["active", "past_due"])
            .order("profile_id")
            .range(from, to),
        ),
        allRows<{ profile_id: string; in_app: boolean | null }>((from, to) =>
          admin
            .from("notification_prefs")
            .select("profile_id, in_app")
            .eq("key", input.key)
            .order("profile_id")
            .range(from, to),
        ),
        allRows<{ profile_id: string }>((from, to) =>
          admin
            .from("notifications")
            .select("profile_id")
            .eq("kind", input.key)
            .eq("link", input.link)
            .order("profile_id")
            .range(from, to),
        ),
      ]);

    const optedOut = new Set(
      prefs.filter((p) => p.in_app === false).map((p) => p.profile_id),
    );
    const done = new Set(already.map((n) => n.profile_id));
    // A person qualifies if ANY of their active grants clears the gate
    // (matches how the portal itself resolves access).
    const eligible = new Set(
      memberships
        .filter(
          (m) =>
            !input.minAccess || canAccess(m.tier as Tier, input.minAccess),
        )
        .map((m) => m.profile_id),
    );
    const targets = Array.from(eligible).filter(
      (id) => !optedOut.has(id) && !done.has(id),
    );

    if (targets.length === 0) return;
    const CHUNK = 500;
    for (let i = 0; i < targets.length; i += CHUNK) {
      await admin.from("notifications").insert(
        targets.slice(i, i + CHUNK).map((profile_id) => ({
          profile_id,
          kind: input.key,
          title: input.title,
          body: input.body || null,
          link: input.link,
        })),
      );
    }
  } catch {
    // Silent by design.
  }
}
