/*
 * Cross-links to the Momentum+ platform — a different deployment on its own
 * domain. Same member accounts (shared Supabase auth), separate session:
 * following these links may prompt a login over there, which is expected.
 */
export function momentumUrl(path = ""): string {
  const base = (
    process.env.NEXT_PUBLIC_MOMENTUM_URL ?? "https://momentumplus.co"
  ).replace(/\/$/, "");
  return `${base}${path}`;
}
