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
