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

/**
 * The GHL contact tag for a badge key.
 *
 * Built from the KEY, never the label. Labels are product copy Matt rewrites
 * ("In the Room" could become anything next month); a tag that follows the
 * copy would orphan every GHL segment, workflow, and offer built on the old
 * name the moment a word changed. The key is the thing we promised not to
 * rename, so it is what the CRM sees.
 *
 *   attendance:gold     → momentum-attendance-gold
 *   milestone:founding  → momentum-milestone-founding
 *   level:committed     → momentum-level-committed
 */
export function badgeTag(badgeKey: string): string {
  return `momentum-${badgeKey.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
}

/**
 * Find-or-create a GHL contact by email, returning its id.
 *
 * Members created by hand (admin grants, invites, comps) have no
 * ghl_contact_id on their membership, and there is no point tagging a
 * contact that does not exist yet.
 */
export async function upsertGhlContactId(
  email: string,
  opts?: { phone?: string | null; name?: string | null },
): Promise<string | null> {
  const { getGhlCreds } = await import("./service-config");
  const creds = await getGhlCreds();
  if (!creds.apiKey || !creds.locationId) return null;
  try {
    const res = await fetch(`${GHL_API_BASE}/contacts/upsert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        locationId: creds.locationId,
        email,
        ...(opts?.phone ? { phone: opts.phone } : {}),
        ...(opts?.name ? { name: opts.name } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { contact?: { id?: string } };
    return json.contact?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Add tags to a GHL contact. ADDITIVE — GHL's tag endpoint appends, so this
 * cannot remove a tag someone set by hand in the CRM, and re-sending a tag
 * the contact already has is a no-op.
 */
export async function addGhlTags(
  contactId: string,
  tags: string[],
): Promise<{ ok: boolean; error?: string }> {
  const clean = [...new Set(tags.filter(Boolean))];
  if (clean.length === 0) return { ok: true };
  const { getGhlCreds } = await import("./service-config");
  const creds = await getGhlCreds();
  if (!creds.apiKey) return { ok: false, error: "GHL not configured" };
  try {
    const res = await fetch(`${GHL_API_BASE}/contacts/${contactId}/tags`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tags: clean }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { ok: false, error: `GHL ${res.status}: ${await res.text()}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
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
    signal: AbortSignal.timeout(10_000),
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
