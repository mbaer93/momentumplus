/*
 * Storage paths for direct browser uploads.
 *
 * Big files can't go through a server action: Vercel caps a serverless
 * request body at ~4.5 MB and enforces it before any of our code runs, so a
 * 20 MB document was rejected by the platform while the app sat there
 * claiming a 25 MB limit. The browser now uploads straight to Supabase
 * Storage on a signed URL and hands the resulting path back.
 *
 * That means the path arrives from the client, so it has to be checked
 * rather than trusted. The server issues the path when it issues the signed
 * URL; on the way back in, `pathInScope` confirms it's the same shape and
 * still inside the scope (session, lesson) the caller was authorised for.
 *
 * Pure so both halves can be tested without a network or a database.
 */

/** Characters that are safe in a storage key, with everything else folded to `_`. */
export function safeFileName(name: string): string {
  return (
    name
      .replace(/[^\w.\-() ]+/g, "_")
      // No ".." anywhere: pathInScope rejects it, so leaving one in would
      // make us generate a path we then refuse to record.
      .replace(/\.{2,}/g, "_")
      .replace(/^\./, "_") // never a dotfile
      .slice(0, 120) || "file"
  );
}

/**
 * A path for a new upload, always one segment below `prefix`.
 *
 * The random suffix keeps two uploads in the same second from overwriting
 * each other — `Date.now()` alone collides when someone attaches several
 * files at once.
 */
export function scopedUploadPath(prefix: string, fileName: string): string {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}${stamp}-${safeFileName(fileName)}`;
}

/**
 * Is this path one we could have issued for `prefix`?
 *
 * Requires exactly one segment under the prefix, which rules out both
 * traversal (`../other-session/x`) and reaching into a nested scope. A
 * client echoing back someone else's path gets rejected here rather than
 * having it recorded against their own row.
 */
export function pathInScope(path: string, prefix: string): boolean {
  if (!path || !prefix) return false;
  if (path.includes("..") || path.includes("\\")) return false;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return rest.length > 0 && !rest.includes("/");
}

/** Where a session's resource files live. */
export function sessionResourcePrefix(sessionId: string): string {
  return `session-resources/${sessionId}/`;
}

/** Where a speaker's notice attachments live. */
export function speakerSharePrefix(sessionId: string): string {
  return `speaker-shares/${sessionId}/`;
}

/** Where a lesson's documents live. */
export function lessonDocumentPrefix(lessonId: string): string {
  return `lesson-${lessonId}/`;
}
