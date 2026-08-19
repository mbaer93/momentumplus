import { createHmac, timingSafeEqual } from "node:crypto";
import type { EmailEventRow, NormalizedEmailEvent } from "@/lib/email-events";

/*
 * The two decisions the Resend webhook makes, lifted out of the route so
 * they can be tested without standing up a request (Phase 8).
 *
 * Both fail quietly in opposite and equally bad directions. A signature
 * check that is too loose lets anyone POST forged delivery events — and
 * "bounced" alerts every Super Admin. One that is too strict rejects every
 * real event, and the symptom is not an error anyone sees: it is an Email
 * Delivery page that simply stays empty forever, which reads as "no
 * problems" rather than "no data".
 */

/** Resend's event names → our normalized ones. */
export const RESEND_EVENT_MAP: Record<string, NormalizedEmailEvent> = {
  "email.delivered": "delivered",
  "email.opened": "open",
  "email.clicked": "click",
  "email.bounced": "bounce",
  "email.complained": "spamreport",
  "email.failed": "dropped",
};

export const SVIX_TOLERANCE_MS = 5 * 60 * 1000;

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

/**
 * Svix signature: HMAC-SHA256 of "{id}.{timestamp}.{body}" with the base64
 * secret. The header carries space-separated "v1,<base64>" candidates,
 * because a secret being rotated produces two valid signatures at once.
 */
export function verifySvixSignature(
  headers: SvixHeaders,
  rawBody: string,
  secret: string | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!secret) return false;
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  // Replay guard: a captured request stays valid forever without it.
  const ts = Number(timestamp) * 1000;
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > SVIX_TOLERANCE_MS) {
    return false;
  }

  const key = Buffer.from(
    secret.startsWith("whsec_") ? secret.slice(6) : secret,
    "base64",
  );
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();

  return signature.split(" ").some((candidate) => {
    const [version, sig] = candidate.split(",");
    if (version !== "v1" || !sig) return false;
    try {
      const got = Buffer.from(sig, "base64");
      // Length check first: timingSafeEqual THROWS on a mismatch, which
      // would turn a malformed signature into a 500 instead of a 401.
      return got.length === expected.length && timingSafeEqual(got, expected);
    } catch {
      return false;
    }
  });
}

export interface ResendPayload {
  type?: string;
  created_at?: string;
  data?: {
    to?: string | string[];
    subject?: string;
    bounce?: { message?: string; subType?: string };
    failed?: { reason?: string };
  };
}

/**
 * Payload → journal rows. Null when the event is one we don't track, which
 * the route answers 200 to: an unknown event type is Resend adding
 * something, not a fault worth retrying.
 */
export function resendEventRows(
  payload: ResendPayload,
  nowIso: string = new Date().toISOString(),
): EmailEventRow[] | null {
  const normalized = payload.type ? RESEND_EVENT_MAP[payload.type] : undefined;
  if (!normalized) return null;

  // One event can carry several recipients; each gets its own row, or a
  // bounce to two addresses would be journaled as one and alert once.
  const recipients = Array.isArray(payload.data?.to)
    ? payload.data.to
    : payload.data?.to
      ? [payload.data.to]
      : ["unknown"];

  const reason =
    payload.data?.bounce?.message ??
    payload.data?.failed?.reason ??
    payload.data?.bounce?.subType ??
    "";

  const occurredAt = payload.created_at
    ? new Date(payload.created_at).toISOString()
    : nowIso;

  return recipients.map((to) => ({
    // Capped: these strings come from outside and land in a table and an
    // alert email.
    email: String(to).slice(0, 200),
    event: normalized,
    reason: reason ? String(reason).slice(0, 200) : null,
    occurred_at: occurredAt,
  }));
}
