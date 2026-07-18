/*
 * Small shared DB helpers.
 */

/**
 * Escape LIKE/ILIKE wildcards so a user-supplied value matches literally.
 * Without this, `john_doe@x.com` also matches `johnadoe@x.com` — and email
 * lookups in webhooks could attach memberships to the wrong profile.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** Case-insensitive exact-match pattern for .ilike() email lookups. */
export function emailPattern(email: string): string {
  return escapeLike(email.trim().toLowerCase());
}

/**
 * Mask an email for logs/API responses that may reach third-party systems
 * (Vercel logs, cron output, webhook callers): `jane@acme.com` → `j***@acme.com`.
 * Enough to correlate a row without exposing the full address.
 */
export function redactEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/**
 * Drain a query past PostgREST's 1000-row page cap. Give it a function that
 * runs the query for one `.range(from, to)` window; it keeps fetching until
 * a short page arrives. Audience fan-outs (announcements, content notify)
 * MUST use this — a plain select silently tops out at 1000 members.
 */
export async function allRows<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { rows, error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return { rows, error: null };
  }
}

/**
 * Constant-time check of an `Authorization: Bearer <secret>` header. Hashing
 * first keeps the compare length-independent. Fails closed when the secret
 * is unset. Use for CRON_SECRET-protected routes.
 */
export function bearerAuthorized(
  header: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || !header || !header.startsWith("Bearer ")) return false;
  const { timingSafeEqual, createHash } = require("crypto") as typeof import("crypto");
  const provided = createHash("sha256").update(header.slice(7)).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(provided, expected);
}
