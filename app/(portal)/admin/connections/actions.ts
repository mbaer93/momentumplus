"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  getGhlCreds,
  getServiceSettings,
  getZoomCreds,
  saveServiceSettings,
  type ZoomCreds,
} from "@/lib/service-config";
import { getZoomAccessToken } from "@/lib/zoom";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface ConnectResult {
  ok: boolean;
  message?: string;
}

async function guardSuper(): Promise<ConnectResult | null> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Connect Supabase before managing connections." };
  }
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (auth.access.role !== "super") {
    return { ok: false, message: "Only the Super Admin can manage connections." };
  }
  return null;
}

function refresh() {
  revalidatePath("/admin/connections");
  revalidatePath("/admin");
}

/** Zoom step 1: Server-to-Server OAuth app — validated by minting a token. */
export async function connectZoomS2S(
  accountId: string,
  clientId: string,
  clientSecret: string,
): Promise<ConnectResult> {
  const early = await guardSuper();
  if (early) return early;
  if (!accountId.trim() || !clientId.trim() || !clientSecret.trim()) {
    return { ok: false, message: "Fill in all three fields from the Zoom app's credentials page." };
  }

  try {
    await getZoomAccessToken({
      accountId: accountId.trim(),
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
    });
  } catch {
    return {
      ok: false,
      message:
        "Zoom rejected those credentials — double-check Account ID, Client ID, and Client Secret, and make sure the app is Activated.",
    };
  }

  const existing = (await getServiceSettings<Partial<ZoomCreds>>("zoom")) ?? {};
  await saveServiceSettings("zoom", {
    ...existing,
    accountId: accountId.trim(),
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
  });
  refresh();
  return { ok: true, message: "Zoom connected — publishing a session now creates the meeting automatically." };
}

/** Zoom step 2: Meeting SDK app (embedded live room). */
export async function connectZoomSdk(
  sdkClientId: string,
  sdkClientSecret: string,
): Promise<ConnectResult> {
  const early = await guardSuper();
  if (early) return early;
  if (!sdkClientId.trim() || !sdkClientSecret.trim()) {
    return { ok: false, message: "Paste both the SDK Client ID and Client Secret." };
  }
  const existing = (await getServiceSettings<Partial<ZoomCreds>>("zoom")) ?? {};
  await saveServiceSettings("zoom", {
    ...existing,
    sdkClientId: sdkClientId.trim(),
    sdkClientSecret: sdkClientSecret.trim(),
  });
  refresh();
  return {
    ok: true,
    message: "Live room credentials saved — members join sessions right inside the portal.",
  };
}

/** Anthropic: validated with a lightweight models call before saving. */
export async function connectAnthropic(apiKey: string): Promise<ConnectResult> {
  const early = await guardSuper();
  if (early) return early;
  const key = apiKey.trim();
  if (!key.startsWith("sk-ant-")) {
    return { ok: false, message: "Anthropic keys start with sk-ant- — copy it from console.anthropic.com → API keys." };
  }

  const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    cache: "no-store",
  }).catch(() => null);
  if (!res?.ok) {
    return { ok: false, message: "Anthropic rejected that key — make sure it's active and has credit." };
  }

  await saveServiceSettings("anthropic", { apiKey: key });
  refresh();
  return { ok: true, message: "Anthropic connected — AI summaries generate automatically after sessions." };
}

/** GHL: validated by fetching the location before saving. */
export async function connectGhl(
  apiKey: string,
  locationId: string,
  webhookSecret: string,
): Promise<ConnectResult> {
  const early = await guardSuper();
  if (early) return early;
  if (!apiKey.trim() || !locationId.trim()) {
    return { ok: false, message: "API key and Location ID are both required." };
  }

  const headers = {
    Authorization: `Bearer ${apiKey.trim()}`,
    Version: "2021-07-28",
  };
  // Two validation attempts: the locations endpoint (needs the View
  // Locations scope), then the contacts endpoint (needs View Contacts —
  // which the platform requires anyway). A token scoped only for
  // contacts/conversations used to fail here despite being usable.
  const locRes = await fetch(
    `https://services.leadconnectorhq.com/locations/${encodeURIComponent(locationId.trim())}`,
    { headers, cache: "no-store" },
  ).catch(() => null);
  let valid = Boolean(locRes?.ok);
  let contactsStatus: number | null = null;
  if (!valid) {
    const contactRes = await fetch(
      `https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId.trim())}&limit=1`,
      { headers, cache: "no-store" },
    ).catch(() => null);
    valid = Boolean(contactRes?.ok);
    contactsStatus = contactRes?.status ?? null;
  }
  if (!valid) {
    const detail = [
      locRes ? `locations check: ${locRes.status}` : "locations check: network error",
      contactsStatus !== null ? `contacts check: ${contactsStatus}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return {
      ok: false,
      message:
        `GHL rejected those credentials (${detail}). Three things to verify: ` +
        "1) the Private Integration was created INSIDE your sub-account (Settings → Private Integrations while in the location, not at the agency level); " +
        "2) it has the View Contacts, Edit Contacts, View Conversations, Edit Conversation Messages, and View Locations scopes; " +
        "3) the Location ID matches that same sub-account (Settings → Business Profile).",
    };
  }

  await saveServiceSettings("ghl", {
    apiKey: apiKey.trim(),
    locationId: locationId.trim(),
    webhookSecret: webhookSecret.trim() || (await getGhlCreds()).webhookSecret,
  });
  refresh();
  return { ok: true, message: "GHL connected." };
}

/** SMTP checklist: send the signed-in admin a real email to prove delivery. */
export async function sendSmtpTestEmail(): Promise<ConnectResult> {
  const early = await guardSuper();
  if (early) return early;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, message: "No email on your account." };

  const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?redirect=/profile`,
  });
  if (error) return { ok: false, message: `Send failed: ${error.message}` };
  return {
    ok: true,
    message: `Test email sent to ${user.email} — if it lands in your inbox within a minute, email is working. (It's a password-reset email; you can ignore it.)`,
  };
}

export async function markSmtpDone(done: boolean): Promise<ConnectResult> {
  const early = await guardSuper();
  if (early) return early;
  await saveServiceSettings("smtp", { done });
  refresh();
  return { ok: true, message: done ? "Email marked as configured." : "Email marked as not configured." };
}
