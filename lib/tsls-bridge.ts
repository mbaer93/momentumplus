/*
 * Outbound cross-app sync to the TSLS Companion (Matt, 2026-07-29: edits
 * in either system carry to the other). Counterpart of TSLS's
 * /api/bridge/update receiver. Auth reuses the existing Momentum+→TSLS
 * trust pair: our TSLS_SSO_KEY === TSLS's TSLS_SSO_SECRET. Pushes are
 * best-effort — a bridge hiccup never fails a save here; TSLS re-syncs on
 * the next edit.
 */

function tslsUrl(path: string): string {
  const base = (
    process.env.NEXT_PUBLIC_TSLS_EVENT_URL ?? "https://app.thetsls.com"
  ).replace(/\/$/, "");
  return `${base}${path}`;
}

async function push(body: Record<string, unknown>): Promise<void> {
  const key = process.env.TSLS_SSO_KEY;
  if (!key) return; // bridge not configured — off-season is normal
  try {
    await fetch(tslsUrl("/api/bridge/update"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Never let a cross-app hiccup fail the save that triggered it.
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
}): Promise<void> {
  if (!input.name.trim()) return;
  await push({ kind: "sponsor", ...input });
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
}): Promise<void> {
  if (!input.email.trim()) return;
  await push({ kind: "person", ...input });
}
