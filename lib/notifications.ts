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
] as const;

export type PrefKey = (typeof PREF_KEYS)[number];

export interface PrefDefinition {
  key: PrefKey;
  label: string;
  description: string;
  emailLocked?: boolean; // platform emails cannot be disabled
}

export const PREF_DEFINITIONS: PrefDefinition[] = [
  {
    key: "session_new",
    label: "New sessions",
    description: "When a new session is added to the calendar",
  },
  {
    key: "session_reminder",
    label: "Session reminders",
    description: "30 minutes before a session you're enrolled in",
  },
  {
    key: "recording_ready",
    label: "Recording ready",
    description: "When a session recording and AI summary are published",
  },
  {
    key: "chat_reply",
    label: "Replies & mentions",
    description: "When someone replies to or mentions you in community chat",
  },
  {
    key: "chat_channel",
    label: "Channel activity",
    description: "Digest of activity in channels you follow",
  },
  {
    key: "chat_dm",
    label: "Direct messages",
    description: "When you receive a direct message",
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
  },
  {
    key: "event_reminder",
    label: "Event reminders",
    description: "TSLS and community event reminders",
  },
];

export interface PrefRow {
  key: PrefKey;
  email: boolean;
  sms: boolean;
  in_app: boolean;
}

/** Default prefs for a member with no saved rows (email+in-app on, SMS off). */
export function defaultPrefs(): PrefRow[] {
  return PREF_DEFINITIONS.map((d) => ({
    key: d.key,
    email: true,
    sms: false,
    in_app: true,
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

export async function sendEmailViaGhl(input: {
  contactId?: string | null;
  email: string;
  subject: string;
  html: string;
}): Promise<{ sent: boolean; reason?: string }> {
  if (!process.env.GHL_API_KEY) {
    console.log(`[notify:email:skipped] ${input.email} — ${input.subject}`);
    return { sent: false, reason: "GHL not configured" };
  }
  if (!input.contactId) {
    return { sent: false, reason: "no GHL contact id" };
  }
  const res = await fetch(`${GHL_API_BASE}/conversations/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      Version: "2021-04-15",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "Email",
      contactId: input.contactId,
      subject: input.subject,
      html: input.html,
    }),
    cache: "no-store",
  });
  if (!res.ok) return { sent: false, reason: `GHL ${res.status}` };
  return { sent: true };
}

export async function sendSmsViaGhl(input: {
  contactId?: string | null;
  phone: string | null;
  message: string;
}): Promise<{ sent: boolean; reason?: string }> {
  // SMS is strictly opt-in; callers must already have checked prefs + phone.
  if (!process.env.GHL_API_KEY) {
    console.log(`[notify:sms:skipped] ${input.phone} — ${input.message}`);
    return { sent: false, reason: "GHL not configured" };
  }
  if (!input.contactId || !input.phone) {
    return { sent: false, reason: "no contact/phone" };
  }
  const res = await fetch(`${GHL_API_BASE}/conversations/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      Version: "2021-04-15",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "SMS",
      contactId: input.contactId,
      message: input.message,
    }),
    cache: "no-store",
  });
  if (!res.ok) return { sent: false, reason: `GHL ${res.status}` };
  return { sent: true };
}
