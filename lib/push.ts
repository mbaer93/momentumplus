/*
 * Web Push delivery. A member enables push per device (Profile →
 * Notifications) — the device subscription itself is the opt-in; sends
 * also respect the member's in-app preference for the notification kind,
 * since push is the out-of-app face of the same alert.
 *
 * Env: NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (npx web-push
 * generate-vapid-keys) and optional VAPID_SUBJECT (mailto: contact).
 * Unconfigured → sends are skipped quietly; nothing else breaks.
 */

import { createServiceClient } from "@/lib/supabase/admin";

export interface PushPayload {
  title: string;
  body?: string;
  /** In-app path the notification opens, e.g. /sessions/abc. */
  link?: string;
}

export function pushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
  );
}

/**
 * Send a push to every subscribed device of the given members. Dead
 * subscriptions (uninstalled PWA, revoked permission → 404/410) are
 * deleted so the table tracks reality. Best-effort by design: callers
 * never fail because push did.
 */
export async function sendPushToProfiles(
  profileIds: string[],
  payload: PushPayload,
): Promise<{ sent: number }> {
  if (!pushConfigured() || profileIds.length === 0) return { sent: 0 };

  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:hello@momentumplus.co",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
    process.env.VAPID_PRIVATE_KEY as string,
  );

  const admin = createServiceClient();
  const message = JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    link: payload.link ?? "/dashboard",
  });

  let sent = 0;
  // .in() with hundreds of ids overflows the querystring — chunk it.
  const ID_CHUNK = 150;
  for (let i = 0; i < profileIds.length; i += ID_CHUNK) {
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("profile_id", profileIds.slice(i, i + ID_CHUNK));

    const rows = subs ?? [];
    // Small concurrent batches: sequential is too slow for 350 members,
    // unbounded hammers the push services.
    const SEND_CHUNK = 20;
    for (let j = 0; j < rows.length; j += SEND_CHUNK) {
      const results = await Promise.allSettled(
        rows.slice(j, j + SEND_CHUNK).map((s) =>
          webpush.sendNotification(
            {
              endpoint: s.endpoint as string,
              keys: { p256dh: s.p256dh as string, auth: s.auth as string },
            },
            message,
          ),
        ),
      );
      const dead: string[] = [];
      results.forEach((r, k) => {
        if (r.status === "fulfilled") {
          sent++;
          return;
        }
        const code = (r.reason as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          dead.push(rows[j + k].id as string);
        }
      });
      if (dead.length > 0) {
        await admin.from("push_subscriptions").delete().in("id", dead);
      }
    }
  }
  return { sent };
}
