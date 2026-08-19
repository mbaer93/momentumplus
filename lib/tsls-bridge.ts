/*
 * Outbound cross-app sync to the TSLS Companion (Matt, 2026-07-29: edits
 * in either system carry to the other). Counterpart of TSLS's
 * /api/bridge/update receiver. Auth reuses the existing Momentum+→TSLS
 * trust pair: our TSLS_SSO_KEY === TSLS's TSLS_SSO_SECRET. Pushes are
 * best-effort — a bridge hiccup never fails a save here; TSLS re-syncs on
 * the next edit.
 */

import { after } from "next/server";

/**
 * Mirror to TSLS AFTER the response is flushed, instead of making the member
 * wait for it (2026-08-19).
 *
 * Every save path here awaited the bridge and then threw the result away.
 * The push carries an 8-second timeout, so a slow or unreachable TSLS added
 * up to 8 seconds to a Save button that had already finished its real work —
 * on a corporate network behind a proxy, the whole of it. The save was never
 * at risk; the wait was pure.
 *
 * after() rather than a floating promise: on serverless a promise nobody
 * awaits can be killed the moment the response returns, which would make the
 * sync LESS reliable than blocking. after() hands the platform the work and
 * keeps the function alive for it.
 *
 * Failures are logged rather than swallowed. They were invisible before —
 * these four callers discarded the result — so a bridge that had been down
 * for a week looked identical to one that was fine.
 */
export function mirrorToTslsAfterResponse(
  label: string,
  run: () => Promise<{ ok: boolean; message?: string }>,
): void {
  after(async () => {
    try {
      const res = await run();
      if (!res.ok) {
        console.warn(`[tsls-bridge] ${label} not mirrored: ${res.message ?? "failed"}`);
      }
    } catch (e) {
      console.warn(
        `[tsls-bridge] ${label} threw: ${e instanceof Error ? e.message : "unknown"}`,
      );
    }
  });
}

function tslsUrl(path: string): string | null {
  // Fail closed when unset (matches app/go/tsls/route.ts): a hardcoded
  // fallback would silently POST member data at a domain we may not own
  // in this deployment.
  const base = (process.env.NEXT_PUBLIC_TSLS_EVENT_URL ?? "").replace(/\/$/, "");
  return base ? `${base}${path}` : null;
}

async function push(
  body: Record<string, unknown>,
): Promise<{ ok: boolean; message?: string }> {
  const key = process.env.TSLS_SSO_KEY;
  if (!key) return { ok: false, message: "TSLS bridge not configured" };
  const url = tslsUrl("/api/bridge/update");
  if (!url) {
    return {
      ok: false,
      message: "TSLS bridge not configured (NEXT_PUBLIC_TSLS_EVENT_URL unset)",
    };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, message: data.error ?? `TSLS returned ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    // Save-triggered callers ignore this; the roster-sync button reports it.
    return {
      ok: false,
      message: e instanceof Error ? e.message : "TSLS unreachable",
    };
  }
}

/** Sponsor listing changed here — mirror it onto the TSLS sponsor page.
    `tier` is the display label (TSLS stores labels). */
export async function pushSponsorToTsls(input: {
  name: string;
  tier?: string | null;
  tagline?: string | null;
  description?: string | null;
  website?: string | null;
  logoUrl?: string | null;
}): Promise<{ ok: boolean; message?: string }> {
  if (!input.name.trim()) return { ok: false, message: "no name" };
  return push({ kind: "sponsor", ...input });
}

/** A person's profile changed here (member, admin, sponsor rep, speaker) —
    mirror name and any speaker-page fields onto TSLS by email. */
export async function pushPersonToTsls(input: {
  email: string;
  name?: string | null;
  title?: string | null;
  bio?: string | null;
  headshotUrl?: string | null;
  website?: string | null;
  /** Comma-separated topic tags (TSLS stores them as one string). */
  tags?: string | null;
}): Promise<{ ok: boolean; message?: string }> {
  if (!input.email.trim()) return { ok: false, message: "no email" };
  return push({ kind: "person", ...input });
}
