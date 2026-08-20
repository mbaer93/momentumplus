import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Inbound ceilings for the x-api-key surfaces (TSLS security review,
 * 2026-08-19, mitigation 2).
 *
 * These routes had no inbound limit at all. The shared key is the control;
 * this is the bound on what a leaked one can do before anyone notices. It is
 * deliberately crude — per-surface, not per-caller, because there is exactly
 * one legitimate caller per surface and a leaked key is indistinguishable
 * from it anyway.
 *
 * TWO WINDOWS. A minute ceiling catches a runaway loop; an hour ceiling
 * catches patient abuse that stays under it. Either alone leaves the other
 * open: 100/min passes an hourly cap for ten minutes, and 500/hr permits a
 * 500-request second.
 *
 * FAILS OPEN, on purpose. If the counter query errors, the request is
 * allowed and the failure is logged. This is a safety net behind a secret,
 * not the control itself — and a limiter outage silently blocking TSLS's
 * guest sync on event day is a worse failure than briefly having no
 * ceiling. Fail-closed would put a database hiccup between a paying
 * attendee and their account.
 */

export interface RateCeiling {
  perMinute: number;
  perHour: number;
}

/*
 * Ceilings are sized from what the legitimate caller actually does, with
 * room, not from what feels tidy.
 */
export const CEILINGS: Record<string, RateCeiling> = {
  // TSLS drains a backlog through here — 79 guests in one run during the
  // August re-push, and a sold-out summit is several hundred. Generous per
  // minute, bounded per hour so a leaked key cannot quietly mint accounts
  // all night.
  "webhooks/zapier": { perMinute: 120, perHour: 1200 },
  // Steady trickle: one call per speaker or sponsor edit.
  "bridge/profile": { perMinute: 60, perHour: 600 },
  // Whole-catalog push on every Event Planning save.
  "bridge/tiers": { perMinute: 30, perHour: 300 },
  // A health probe. Cheap, but no reason for thousands.
  "bridge/ping": { perMinute: 60, perHour: 600 },
  /*
   * Pressed once, ever. The low ceiling is the point: it still allows the
   * retries a real reveal needs (drain the remainder, press again when
   * unsure it worked) while making "fire it repeatedly" impossible. It has
   * its own secret too — this is the second lock on the same door.
   */
  "bridge/reveal": { perMinute: 10, perHour: 60 },
  // Mints a one-time login link for an existing account. A leaked handoff
  // secret plus an email list is the enumeration risk this bounds.
  "sso/handoff": { perMinute: 60, perHour: 600 },
};

async function bump(
  surface: string,
  windowSeconds: number,
  limit: number,
): Promise<{ over: boolean; count: number } | null> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const startMs = Math.floor(now / windowMs) * windowMs;
  const { data, error } = await createServiceClient().rpc("api_rate_bump", {
    p_bucket: `${surface}:${windowSeconds}:${startMs}`,
    p_window_start: new Date(startMs).toISOString(),
  });
  if (error) return null; // caller decides; see fail-open note above
  const count = Number(data ?? 0);
  return { over: count > limit, count };
}

/**
 * Returns a 429 response if this surface is over its ceiling, else null.
 *
 * Pass the surface key from CEILINGS. An unknown surface is not limited —
 * better than inventing a ceiling for a route nobody sized.
 */
export async function rateLimited(
  surface: string,
): Promise<NextResponse | null> {
  const ceiling = CEILINGS[surface];
  if (!ceiling) return null;
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  try {
    const [minute, hour] = await Promise.all([
      bump(surface, 60, ceiling.perMinute),
      bump(surface, 3600, ceiling.perHour),
    ]);

    // Pre-migration (0096) or a database blip: allow, but say so. A ceiling
    // that has quietly stopped working must not look like one that is.
    if (minute === null || hour === null) {
      console.warn(`[rate-limit] ${surface}: counter unavailable, allowing`);
      return null;
    }

    if (minute.over || hour.over) {
      const which = minute.over
        ? `${minute.count}/${ceiling.perMinute} per minute`
        : `${hour.count}/${ceiling.perHour} per hour`;
      // Logged every time it trips: being at a ceiling is either a leaked
      // key or a ceiling set too low, and both need a human.
      console.warn(`[rate-limit] ${surface} OVER — ${which}`);
      return NextResponse.json(
        { error: `Rate limit exceeded for ${surface}. Try again shortly.` },
        { status: 429, headers: { "retry-after": minute.over ? "60" : "300" } },
      );
    }
    return null;
  } catch (e) {
    console.warn(
      `[rate-limit] ${surface}: ${e instanceof Error ? e.message : "failed"}, allowing`,
    );
    return null;
  }
}
