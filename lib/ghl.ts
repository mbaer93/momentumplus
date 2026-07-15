import { createHmac, timingSafeEqual } from "crypto";

/*
 * Go High Level integration (SPEC.md §4). GHL is the source of truth for
 * payment status; webhooks hit /api/webhooks/ghl and are verified here.
 *
 * Webhook auth (GHL workflow "Custom Webhook" action): either
 *   - x-ghl-signature: hex HMAC-SHA256 of the raw request body using
 *     GHL_WEBHOOK_SECRET (preferred), or
 *   - x-webhook-secret: the shared secret verbatim (for workflows that can
 *     only set a static header).
 * Both compare timing-safe. No secret configured → reject everything.
 */

export function isGhlConfigured(): boolean {
  return Boolean(process.env.GHL_API_KEY && process.env.GHL_LOCATION_ID);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyGhlWebhook(
  rawBody: string,
  headers: { signature?: string | null; sharedSecret?: string | null },
  secret: string | undefined = process.env.GHL_WEBHOOK_SECRET,
): boolean {
  if (!secret) return false;

  if (headers.signature) {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    return safeEqual(headers.signature.toLowerCase(), expected);
  }
  if (headers.sharedSecret) {
    return safeEqual(headers.sharedSecret, secret);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Minimal GHL API client (LeadConnector v2) — used by nightly reconciliation.
// ---------------------------------------------------------------------------

const GHL_API_BASE = "https://services.leadconnectorhq.com";

export interface GhlContact {
  id: string;
  email: string | null;
  tags: string[];
}

export async function getGhlContact(
  contactId: string,
): Promise<GhlContact | null> {
  const { getGhlCreds } = await import("./service-config");
  const creds = await getGhlCreds();
  if (!creds.apiKey || !creds.locationId) return null;

  const res = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      Version: "2021-07-28",
    },
    cache: "no-store",
  });
  if (!res.ok) return null;

  const json = (await res.json()) as {
    contact?: { id: string; email?: string; tags?: string[] };
  };
  if (!json.contact) return null;
  return {
    id: json.contact.id,
    email: json.contact.email?.toLowerCase() ?? null,
    tags: json.contact.tags ?? [],
  };
}
