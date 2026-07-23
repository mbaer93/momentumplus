/*
 * Notification delivery (SPEC.md §4). Email goes through GHL so all member
 * email lives in one system; SMS is strictly opt-in; in-app rows land in the
 * notifications table (Supabase realtime feeds the bell). Everything is
 * env-gated: in preview mode sends are logged, not delivered.
 */

// Preference keys (SPEC.md §3 notification_prefs).
export const PREF_KEYS = [
  "session_new",
  "session_reminder",
  "recording_ready",
  "chat_reply",
  "chat_channel",
  "chat_dm",
  "platform", // email locked on
  "resource_new",
  "event_reminder",
  "announcements", // SMS opt-in only — email/in-app announcements ride "platform"
  "dropin_reminder", // Rooted Focus / Aspire2Achieve — opt-in, default OFF
] as const;

export type PrefKey = (typeof PREF_KEYS)[number];

export interface PrefDefinition {
  key: PrefKey;
  label: string;
  description: string;
  emailLocked?: boolean; // platform emails cannot be disabled
  /** Only the in-app bell is wired for this key — hide email/SMS toggles. */
  inAppOnly?: boolean;
  /** Only the SMS toggle is wired for this key — hide email/in-app toggles. */
  smsOnly?: boolean;
  /** No sender exists yet — hidden from the preferences UI until one does
      (showing a toggle that controls nothing erodes trust). */
  hidden?: boolean;
}

export const PREF_DEFINITIONS: PrefDefinition[] = [
  {
    key: "session_new",
    label: "New sessions",
    description: "When a new session is published to the calendar",
    inAppOnly: true,
  },
  {
    key: "session_reminder",
    label: "Session reminders",
    description: "30 minutes before a session you're enrolled in",
  },
  {
    key: "recording_ready",
    label: "Recording ready",
    description: "When a new recording lands in the Library",
    inAppOnly: true,
  },
  {
    key: "chat_reply",
    label: "Replies & mentions",
    description: "When someone replies to or mentions you in community chat",
    hidden: true, // no sender yet
  },
  {
    key: "chat_channel",
    label: "Channel activity",
    description: "Digest of activity in channels you follow",
    hidden: true, // no sender yet
  },
  {
    key: "chat_dm",
    label: "Direct messages",
    description: "When you receive a direct message",
    hidden: true, // no sender yet
  },
  {
    key: "platform",
    label: "Platform & account",
    description: "Billing, membership, and account notices",
    emailLocked: true,
  },
  {
    key: "resource_new",
    label: "New resources",
    description: "When partner resources are added",
    inAppOnly: true,
  },
  {
    key: "event_reminder",
    label: "Event reminders",
    description: "TSLS and community event reminders",
    hidden: true, // no sender yet
  },
  {
    key: "announcements",
    label: "Announcement texts",
    description:
      "Text me announcements from the SLC team (requires a phone number)",
    smsOnly: true,
  },
  {
    key: "dropin_reminder",
    label: "Rooted Focus & Aspire2Achieve reminders",
    description:
      "30 minutes before each drop-in session — off unless you opt in",
  },
];

export interface PrefRow {
  key: PrefKey;
  email: boolean;
  sms: boolean;
  in_app: boolean;
}

/** Default prefs for a member with no saved rows (email+in-app on, SMS off).
    dropin_reminder is fully opt-IN — every channel starts off. */
export function defaultPrefs(): PrefRow[] {
  return PREF_DEFINITIONS.map((d) => ({
    key: d.key,
    email: d.key !== "dropin_reminder",
    sms: false,
    in_app: d.key !== "dropin_reminder",
  }));
}

/** Merge saved rows over defaults; enforce the platform email lock. */
export function mergePrefs(saved: Partial<PrefRow>[]): PrefRow[] {
  const byKey = new Map(saved.map((r) => [r.key, r]));
  return defaultPrefs().map((d) => {
    const row = byKey.get(d.key);
    const merged = {
      key: d.key,
      email: row?.email ?? d.email,
      sms: row?.sms ?? d.sms,
      in_app: row?.in_app ?? d.in_app,
    };
    if (d.key === "platform") merged.email = true; // locked on
    return merged;
  });
}

// ---------------------------------------------------------------------------
// Delivery (env-gated)
// ---------------------------------------------------------------------------

const GHL_API_BASE = "https://services.leadconnectorhq.com";

/**
 * Find-or-create the GHL contact for an email address. Members created by
 * hand (admin grants, invites, comps) have no ghl_contact_id on their
 * membership — without this, every email to them silently skipped.
 */
async function upsertGhlContact(
  email: string,
  apiKey: string,
  locationId: string,
  phone?: string | null,
): Promise<string | null> {
  try {
    const res = await fetch(`${GHL_API_BASE}/contacts/upsert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
      // Include the phone when we have it — GHL texts the CONTACT's phone,
      // so an SMS to a phoneless contact goes nowhere.
      body: JSON.stringify({ locationId, email, ...(phone ? { phone } : {}) }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { contact?: { id?: string } };
    return json.contact?.id ?? null;
  } catch {
    return null;
  }
}

export async function sendEmailViaGhl(input: {
  contactId?: string | null;
  email: string;
  subject: string;
  html: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const { getGhlCreds } = await import("./service-config");
  const creds = await getGhlCreds();
  if (!creds.apiKey) {
    // No member PII in logs — an email address is itself personal data.
    console.log("[notify:email:skipped] GHL not configured");
    return { sent: false, reason: "GHL not configured" };
  }
  let contactId = input.contactId ?? null;
  if (!contactId && creds.locationId) {
    contactId = await upsertGhlContact(input.email, creds.apiKey, creds.locationId);
  }
  if (!contactId) {
    return { sent: false, reason: "no GHL contact id" };
  }
  const send = (emailFrom: string) =>
    fetch(`${GHL_API_BASE}/conversations/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        Version: "2021-04-15",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "Email",
        contactId,
        subject: input.subject,
        html: input.html,
        emailFrom,
      }),
      cache: "no-store",
    });
  // From line per Sierra: her monitored address (aligned with the
  // location's Mailgun sending domain), Momentum+ as the display name.
  // Overridable via env.
  const fromFull =
    process.env.GHL_EMAIL_FROM || "Momentum+ Team <grow@sierralearnership.com>";
  let res = await send(fromFull);
  if (!res.ok && (res.status === 400 || res.status === 422)) {
    // Some GHL validators reject the `Name <address>` form — retry with
    // just the bare address before giving up.
    const bare = /<([^>]+)>/.exec(fromFull)?.[1];
    if (bare) res = await send(bare);
  }
  if (!res.ok) {
    // Surface WHY — "1 email failed" with no reason is undebuggable from
    // the admin screen. No PII: this is GHL's error text, not the member's.
    let detail = "";
    try {
      const j = (await res.json()) as { message?: unknown; error?: unknown };
      detail = String(j.message ?? j.error ?? "").slice(0, 140);
    } catch {
      /* non-JSON error body */
    }
    return {
      sent: false,
      reason: `GHL ${res.status}${detail ? `: ${detail}` : ""}`,
    };
  }
  return { sent: true };
}

export async function sendSmsViaGhl(input: {
  contactId?: string | null;
  /** Used to find-or-create the GHL contact when no contactId is linked. */
  email?: string;
  phone: string | null;
  message: string;
}): Promise<{ sent: boolean; reason?: string }> {
  // SMS is strictly opt-in; callers must already have checked prefs + phone.
  const { getGhlCreds } = await import("./service-config");
  const creds = await getGhlCreds();
  if (!creds.apiKey) {
    // No phone number or message body in logs — both are personal data.
    console.log("[notify:sms:skipped] GHL not configured");
    return { sent: false, reason: "GHL not configured" };
  }
  if (!input.phone) {
    return { sent: false, reason: "no contact/phone" };
  }
  // GHL delivers SMS to the CONTACT's phone, not a number we pass — so
  // upsert by email with the phone attached. This both creates missing
  // contacts (members who never came through GHL) and fills in a phone the
  // existing contact may lack. Fall back to the linked id if upsert fails.
  let contactId = input.contactId ?? null;
  if (input.email && creds.locationId) {
    contactId =
      (await upsertGhlContact(
        input.email,
        creds.apiKey,
        creds.locationId,
        input.phone,
      )) ?? contactId;
  }
  if (!contactId) {
    return { sent: false, reason: "no contact/phone" };
  }
  const res = await fetch(`${GHL_API_BASE}/conversations/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      Version: "2021-04-15",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "SMS",
      contactId,
      message: input.message,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    // Surface WHY (GHL's error text, no member PII) — silent SMS failures
    // burned a test run already.
    let detail = "";
    try {
      const j = (await res.json()) as { message?: unknown; error?: unknown };
      detail = String(j.message ?? j.error ?? "").slice(0, 140);
    } catch {
      /* non-JSON error body */
    }
    return {
      sent: false,
      reason: `GHL ${res.status}${detail ? `: ${detail}` : ""}`,
    };
  }
  return { sent: true };
}
