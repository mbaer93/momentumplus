import { createHash } from "node:crypto";

/*
 * The decisions /api/errors makes before it writes anything (Phase 8).
 *
 * This endpoint is PUBLIC — error boundaries fire for signed-out visitors
 * too — so these guards are the only thing between a bot and Matt's inbox.
 * Lifted out of the route so each one can be tested on its own, because the
 * failures they prevent (an inbox storm, a forged row) are not things a
 * passing build would ever reveal.
 */

/** One email per distinct error, and one across all errors, per window. */
export const EMAIL_THROTTLE_MS = 6 * 60 * 60 * 1000;

/*
 * Paths a SIGNED-OUT visitor may report from. Both are payment paths: a
 * crash there is a visitor trying to give us money and failing, and losing
 * those reports left revenue-path breakage invisible (audit P2-21).
 */
export const PUBLIC_REPORT_PATHS = ["/join", "/tickets"];

/** Fingerprint for a report: the same message on the same page is one error. */
export function errorFingerprint(message: string, path: string): string {
  return createHash("sha256")
    .update(`${message}|${path}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Which fixed bucket an anonymous report lands in, or null if the path is
 * not one visitors may report from.
 *
 * The hash comes from the PATH ALONE, never the message. That is the whole
 * abuse bound: attacker-controlled text in the fingerprint would let a bot
 * mint unlimited distinct rows, so however much junk arrives it can only
 * ever bump one counter per public path.
 */
export function anonymousBucket(
  path: string,
): { hash: string; path: string } | null {
  const matched = PUBLIC_REPORT_PATHS.find(
    (p) => path === p || path.startsWith(`${p}?`) || path.startsWith(`${p}/`),
  );
  if (!matched) return null;
  return {
    hash: createHash("sha256").update(`anon|${matched}`).digest("hex").slice(0, 32),
    path: matched,
  };
}

/** Has enough time passed since the last alert to send another? */
export function throttleExpired(
  lastEmailedAt: string | null | undefined,
  nowMs: number,
): boolean {
  if (!lastEmailedAt) return true;
  const last = new Date(lastEmailedAt).getTime();
  // An unparseable timestamp must not read as "never emailed" — that would
  // turn one bad row into an alert on every single report.
  if (!Number.isFinite(last)) return false;
  return nowMs - last >= EMAIL_THROTTLE_MS;
}
