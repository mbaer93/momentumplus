/*
 * TSLS → Momentum+ speaker pull (Matt, 2026-08-05).
 *
 * The rule: every TSLS speaker is a Momentum+ speaker — main-stage and
 * panelists alike — EXCEPT the Emcee, who is the one exception. (The
 * reverse doesn't hold: Momentum+ has speakers who never touch TSLS, and
 * the pull must never modify or remove them.)
 *
 * Auth reuses the Momentum+→TSLS trust pair from lib/tsls-bridge.ts:
 * our TSLS_SSO_KEY === TSLS's TSLS_SSO_SECRET.
 *
 * Contract (TSLS side: GET /api/bridge/speakers):
 *   Header:  x-api-key: <TSLS_SSO_SECRET>
 *   Reply:   { "speakers": [{ "name", "email"?, "title"?, "bio"?,
 *              "headshotUrl"?, "website"?, "tags"?: [],
 *              "role"?: "main" | "panelist" | "emcee" }] }
 *   role defaults to "main" when absent.
 */

export interface TslsSpeaker {
  name: string;
  email: string | null;
  title: string | null;
  bio: string | null;
  headshotUrl: string | null;
  website: string | null;
  tags: string[];
  role: "main" | "panelist" | "emcee";
}

/** Normalize a person's name for cross-app matching: lowercase, drop
    credentials after a comma ("Holly Bertone, PMP"), strip periods,
    drop single-letter middle initials, collapse whitespace. */
export function speakerNameKey(name: string): string {
  const base = name.split(",")[0] ?? "";
  const tokens = base
    .toLowerCase()
    .replace(/\./g, "")
    .split(/\s+/)
    .filter(Boolean);
  const kept =
    tokens.length > 2
      ? tokens.filter((t, i) => i === 0 || i === tokens.length - 1 || t.length > 1)
      : tokens;
  return kept.join(" ");
}

function asRole(value: unknown): TslsSpeaker["role"] {
  return value === "panelist" || value === "emcee" ? value : "main";
}

/** Parse the TSLS reply defensively — a missing or malformed entry is
    skipped, never thrown on. */
export function parseTslsSpeakers(payload: unknown): TslsSpeaker[] {
  const list = (payload as { speakers?: unknown })?.speakers;
  if (!Array.isArray(list)) return [];
  const out: TslsSpeaker[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name) continue;
    out.push({
      name,
      email:
        typeof r.email === "string" && r.email.includes("@")
          ? r.email.trim().toLowerCase()
          : null,
      title: typeof r.title === "string" && r.title.trim() ? r.title.trim() : null,
      bio: typeof r.bio === "string" && r.bio.trim() ? r.bio.trim() : null,
      headshotUrl:
        typeof r.headshotUrl === "string" && r.headshotUrl.trim()
          ? r.headshotUrl.trim()
          : null,
      website:
        typeof r.website === "string" && r.website.trim() ? r.website.trim() : null,
      tags: Array.isArray(r.tags)
        ? r.tags.filter((t): t is string => typeof t === "string" && t.trim() !== "")
        : [],
      role: asRole(r.role),
    });
  }
  return out;
}

/** Fetch the TSLS speaker lineup. Fails closed with a reason when the
    bridge isn't configured or TSLS doesn't have its endpoint yet. */
export async function fetchTslsSpeakers(): Promise<
  { ok: true; speakers: TslsSpeaker[] } | { ok: false; message: string }
> {
  const key = process.env.TSLS_SSO_KEY;
  if (!key) return { ok: false, message: "TSLS bridge not configured (TSLS_SSO_KEY unset)" };
  const base = (process.env.NEXT_PUBLIC_TSLS_EVENT_URL ?? "").replace(/\/$/, "");
  if (!base) {
    return {
      ok: false,
      message: "TSLS bridge not configured (NEXT_PUBLIC_TSLS_EVENT_URL unset)",
    };
  }
  try {
    const res = await fetch(`${base}/api/bridge/speakers`, {
      headers: { "x-api-key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404) {
      return {
        ok: false,
        message:
          "TSLS doesn't expose its speaker list yet — deploy the TSLS /api/bridge/speakers endpoint first.",
      };
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, message: data.error ?? `TSLS returned ${res.status}` };
    }
    return { ok: true, speakers: parseTslsSpeakers(await res.json()) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "TSLS unreachable",
    };
  }
}
