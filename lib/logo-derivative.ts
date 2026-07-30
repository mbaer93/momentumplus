import type { SupabaseClient } from "@supabase/supabase-js";
import { trimLogoBuffer } from "./logo-trim";

/*
 * Safe margin-trimming for sponsor logos — the rebuilt version of the
 * 07-29 feature whose first cut corrupted production files (the sharp
 * output buffer was string-coerced somewhere in the storage upload,
 * leaving UTF-8 replacement bytes; local runs were unaffected).
 *
 * Design rules that make the failure mode impossible to repeat:
 *  1. The uploaded original is NEVER touched. Trimmed bytes go to a
 *     separate derivative object (`<raw path stem>-trim-<n>.<ext>`).
 *  2. Every write is read back and compared byte-for-byte before any
 *     sponsor row points at it. A mismatch (or an undecodable read-back)
 *     deletes the derivative and keeps the original in place.
 *  3. Undo is trivial: the raw object still exists, so reverting is just
 *     pointing logo_url back at it (see rawPathFor).
 */

export const BUCKET = "sponsor-logos";

export const EXT_CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Storage object path out of a stored public URL, or null if the URL
    doesn't live in the sponsor-logos bucket. */
export function storagePathFromUrl(url: string): string | null {
  const clean = url.split("?")[0];
  const marker = `/${BUCKET}/`;
  const idx = clean.indexOf(marker);
  if (idx < 0) return null;
  return decodeURIComponent(clean.slice(idx + marker.length));
}

const TRIM_RE = /-trim-\d+(\.[a-z0-9]+)$/i;

/** Is this object a trim derivative (vs an uploaded original)? */
export function isTrimPath(path: string): boolean {
  return TRIM_RE.test(path);
}

/** The original's path for a derivative ("abc-trim-17.png" → "abc.png");
    a raw path comes back unchanged. */
export function rawPathFor(path: string): string {
  return path.replace(TRIM_RE, "$1");
}

export interface TrimApplyResult {
  /** URL to store on the sponsor row (cache-busted). Null = keep as-is. */
  url: string | null;
  outcome:
    | "trimmed"
    | "already-tight"
    | "svg"
    | "unsupported"
    | "missing"
    | "verify-failed"
    | "error";
  detail: string;
}

/**
 * Produce a verified trimmed derivative for the raw object at `rawPath`.
 * Returns the derivative's public URL only after the read-back matches
 * what was written; every other outcome leaves storage pointing rows at
 * whatever they already had. Never throws.
 */
export async function applyTrimmedLogo(
  admin: SupabaseClient,
  rawPath: string,
): Promise<TrimApplyResult> {
  try {
    const ext = rawPath.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "svg") {
      return { url: null, outcome: "svg", detail: "SVG — vector, no trim needed" };
    }
    const contentType = EXT_CONTENT_TYPE[ext];
    if (!contentType) {
      return { url: null, outcome: "unsupported", detail: `unsupported type .${ext}` };
    }

    const storage = admin.storage.from(BUCKET);
    const { data: blob, error: dlErr } = await storage.download(rawPath);
    if (dlErr || !blob) {
      return {
        url: null,
        outcome: "missing",
        detail: dlErr?.message ?? "original file not found",
      };
    }
    const raw = Buffer.from(await blob.arrayBuffer());

    const result = await trimLogoBuffer(raw, contentType);
    if (!result.trimmed) {
      return { url: null, outcome: "already-tight", detail: "no margins to trim" };
    }

    // Fresh copy of the sharp output, sent as a Blob: two independent
    // guards against the binary body being coerced to text in transit.
    const bytes = Buffer.from(new Uint8Array(result.buffer));
    const stem = rawPath.slice(0, rawPath.length - (ext.length + 1));
    const trimPath = `${stem}-trim-${Date.now()}.${ext}`;
    const { error: upErr } = await storage.upload(
      trimPath,
      new Blob([bytes], { type: contentType }),
      { contentType, upsert: true },
    );
    if (upErr) return { url: null, outcome: "error", detail: upErr.message };

    // The write is only trusted after reading it back identical.
    const { data: check, error: checkErr } = await storage.download(trimPath);
    const checkBytes = check ? Buffer.from(await check.arrayBuffer()) : null;
    if (checkErr || !checkBytes || !checkBytes.equals(bytes)) {
      await storage.remove([trimPath]).catch(() => undefined);
      return {
        url: null,
        outcome: "verify-failed",
        detail: `stored bytes did not match (${checkBytes?.length ?? 0}B vs ${bytes.length}B) — original kept`,
      };
    }

    // Success — hand back the verified derivative's URL, then tidy any
    // older derivatives of this logo (the raw object always stays).
    const { data: pub } = storage.getPublicUrl(trimPath);
    const prefix = `${stem}-trim-`;
    const dir = stem.includes("/") ? stem.slice(0, stem.lastIndexOf("/")) : "";
    const base = stem.includes("/") ? stem.slice(stem.lastIndexOf("/") + 1) : stem;
    const { data: siblings } = await storage.list(dir, {
      search: `${base}-trim-`,
    });
    const stale = (siblings ?? [])
      .map((o) => (dir ? `${dir}/${o.name}` : o.name))
      .filter((p) => p.startsWith(prefix) && p !== trimPath);
    if (stale.length > 0) await storage.remove(stale).catch(() => undefined);

    return {
      url: `${pub.publicUrl}?v=${Date.now()}`,
      outcome: "trimmed",
      detail: `${result.before.width}×${result.before.height} → ${result.after.width}×${result.after.height}`,
    };
  } catch (e) {
    return {
      url: null,
      outcome: "error",
      detail: e instanceof Error ? e.message : "unexpected failure",
    };
  }
}
