import { headers } from "next/headers";

/**
 * The site's public URL, derived from the live request first so links are
 * right even when NEXT_PUBLIC_SITE_URL is unset or stale. Only call from a
 * request scope (server actions, route handlers); crons/webhooks without a
 * meaningful Host fall back to the env var.
 */
export function requestSiteUrl(): string | null {
  try {
    const h = headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host && !host.startsWith("localhost") && !host.startsWith("127.")) {
      const proto = h.get("x-forwarded-proto") ?? "https";
      return `${proto}://${host}`;
    }
  } catch {
    // outside a request scope
  }
  return process.env.NEXT_PUBLIC_SITE_URL ?? null;
}
