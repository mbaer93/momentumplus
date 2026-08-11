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

/*
 * Titles people put in front of their name. Stripped from the FRONT only,
 * repeatedly ("Rev. Dr. Marcus Hall").
 */
const HONORIFICS = new Set([
  "dr", "mr", "mrs", "ms", "miss", "mx", "prof", "professor", "rev",
  "reverend", "fr", "father", "pastor", "rabbi", "imam", "hon", "coach",
  "sgt", "capt", "col", "gen", "lt", "maj",
]);

/*
 * Credentials and generational suffixes. Stripped from the END only, and
 * only while at least two name tokens remain — so a person whose surname
 * happens to collide with a credential keeps it.
 *
 * Deliberately excludes the single letter "v": as a Roman numeral it is
 * far rarer than a legitimate final initial, and dropping it would fold
 * two different people together. Folding two people into one row is a
 * worse failure than leaving a duplicate.
 */
const SUFFIXES = new Set([
  "jr", "snr", "sr", "ii", "iii", "iv", "phd", "md", "edd", "dds", "dvm",
  "jd", "esq", "mba", "mfa", "rn", "cpa", "pmp", "lcsw", "lpc", "cfa",
  "aia", "sphr", "shrm", "cae", "cfp",
]);
/*
 * Deliberately NOT in the list above: ma, ba, bs, bsc, msc, pe. Each is a
 * real surname somewhere — "Robert Wei Ma" would lose its surname and fold
 * into a different person. Missing the "Jane Smith MA" spelling costs one
 * duplicate row an admin can merge; merging two people costs a speaker
 * their identity, and it is not obvious afterwards that it happened.
 */

/**
 * Normalize a person's name for cross-app matching.
 *
 * Handles: casing and stray whitespace; credentials after a comma ("Holly
 * Bertone, PMP"); single-letter middle initials; honorific prefixes
 * ("Dr. Jane Smith"); trailing credentials with no comma ("Jane Smith
 * PhD", "John Smith Jr"); curly vs straight apostrophes; hyphenated vs
 * spaced compound names ("Anne-Marie" / "Anne Marie"); and accents.
 *
 * Every one of those is a way the same person is typed differently in the
 * two apps, and every mismatch here becomes a duplicate speaker row on
 * the next TSLS pull (Matt, 2026-08-11).
 */
export function speakerNameKey(name: string): string {
  const base = (name.split(",")[0] ?? "")
    // Curly quotes/apostrophes -> straight, dashes -> space, so O’Brien
    // matches O'Brien and Anne-Marie matches Anne Marie.
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐-―\-]/g, " ")
    // Strip accents: José and Jose are one person.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.]/g, "");

  let tokens = base.split(/\s+/).filter(Boolean);

  // Honorifics off the front.
  while (tokens.length > 1 && HONORIFICS.has(tokens[0])) tokens = tokens.slice(1);
  // Credentials/generational suffixes off the back.
  while (tokens.length > 2 && SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens = tokens.slice(0, -1);
  }
  // Single-letter middle initials.
  if (tokens.length > 2) {
    tokens = tokens.filter(
      (t, i) => i === 0 || i === tokens.length - 1 || t.length > 1,
    );
  }
  return tokens.join(" ");
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

/**
 * Group speaker rows that normalize to the same name — i.e. rows that are
 * almost certainly the same person entered twice.
 *
 * Exists because the pull used to fail silently: when matching missed, it
 * inserted a second row and reported it as "added", so a duplicated pull
 * looked identical to a successful one. The pull now reports these, and
 * the admin Speakers page can show them for rows that already exist.
 */
export function findLikelyDuplicates<T extends { id: string; name: string }>(
  rows: T[],
): Array<{ key: string; rows: T[] }> {
  const byKey = new Map<string, T[]>();
  for (const row of rows) {
    const key = speakerNameKey(String(row.name));
    if (!key) continue;
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }
  return [...byKey.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, rows: list }));
}
