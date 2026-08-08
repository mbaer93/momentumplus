/*
 * next/image only loads hosts listed in next.config's remotePatterns. Handing
 * it anything else does not degrade to a broken <img> — the component THROWS,
 * which takes down the whole page, not just the one card. The Speakers grid
 * renders every headshot, so a single bad URL blanks the directory for
 * everyone.
 *
 * Two entry points can store a URL we never uploaded:
 *   - POST /api/bridge/profile (headshotUrl, pushed from TSLS)
 *   - Admin -> Ad Manager (a pasted image URL)
 * Both are checked on write, and every read falls back to the placeholder
 * that already exists for the no-image case, so rows stored before this
 * degrade to initials instead of a 500.
 *
 * Keep ALLOWED_HOSTS in step with next.config.ts remotePatterns.
 */

/** Matches the remotePatterns in next.config.ts. */
function hostAllowed(u: URL): boolean {
  if (u.hostname === "image.mux.com") return true;
  // { hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" }
  // The wildcard is one label deep, and the path prefix is part of the rule.
  if (
    /^[^.]+\.supabase\.co$/.test(u.hostname) &&
    u.pathname.startsWith("/storage/v1/object/public/")
  ) {
    return true;
  }
  return false;
}

/**
 * True when `src` is something next/image can actually load: a same-origin
 * path, or an https URL on an allowed remote host.
 */
export function imageSrcOk(src: string | null | undefined): boolean {
  if (!src) return false;
  const s = src.trim();
  if (!s) return false;
  // Relative paths are served from our own origin — always fine.
  if (s.startsWith("/") && !s.startsWith("//")) return true;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  return hostAllowed(u);
}

/**
 * The value to hand a next/image `src`, or null to render the placeholder.
 * Use at every read of a stored image URL.
 */
export function safeImageSrc(src: string | null | undefined): string | null {
  return imageSrcOk(src) ? src!.trim() : null;
}
