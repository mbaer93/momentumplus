import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * In-app service connections (Admin → Connections). Credentials pasted into
 * the wizards live in app_settings (service-role only) and take precedence
 * over environment variables, so connecting Zoom/Anthropic/GHL never requires
 * touching Vercel. Env vars still work as a fallback for anything set the
 * old way.
 */

export type ServiceKey = "zoom" | "anthropic" | "ghl" | "smtp" | "whitney";

export async function getServiceSettings<T>(key: ServiceKey): Promise<T | null> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  try {
    const { data } = await createServiceClient()
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    return (data?.value as T | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveServiceSettings(
  key: ServiceKey,
  value: unknown,
): Promise<void> {
  await createServiceClient()
    .from("app_settings")
    .upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
}

// ---------------------------------------------------------------------------
// Zoom (S2S OAuth app for meetings + Meeting SDK app for the embedded room)
// ---------------------------------------------------------------------------

export interface ZoomCreds {
  accountId: string | null;
  clientId: string | null;
  clientSecret: string | null;
  sdkClientId: string | null;
  sdkClientSecret: string | null;
}

export async function getZoomCreds(): Promise<ZoomCreds> {
  const db = await getServiceSettings<Partial<ZoomCreds>>("zoom");
  return {
    accountId: db?.accountId ?? process.env.ZOOM_ACCOUNT_ID ?? null,
    clientId: db?.clientId ?? process.env.ZOOM_CLIENT_ID ?? null,
    clientSecret: db?.clientSecret ?? process.env.ZOOM_CLIENT_SECRET ?? null,
    sdkClientId: db?.sdkClientId ?? process.env.ZOOM_SDK_CLIENT_ID ?? null,
    sdkClientSecret:
      db?.sdkClientSecret ?? process.env.ZOOM_SDK_CLIENT_SECRET ?? null,
  };
}

export async function isZoomReady(): Promise<boolean> {
  const c = await getZoomCreds();
  return Boolean(c.accountId && c.clientId && c.clientSecret);
}

export async function isZoomSdkReady(): Promise<boolean> {
  const c = await getZoomCreds();
  return Boolean(c.sdkClientId && c.sdkClientSecret);
}

// ---------------------------------------------------------------------------
// Anthropic (AI session summaries)
// ---------------------------------------------------------------------------

export async function getAnthropicApiKey(): Promise<string | null> {
  const db = await getServiceSettings<{ apiKey?: string }>("anthropic");
  return db?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? null;
}

export async function isAnthropicReady(): Promise<boolean> {
  return Boolean(await getAnthropicApiKey());
}

// ---------------------------------------------------------------------------
// Go High Level (legacy payments + webhook sync)
// ---------------------------------------------------------------------------

export interface GhlCreds {
  apiKey: string | null;
  locationId: string | null;
  webhookSecret: string | null;
}

export async function getGhlCreds(): Promise<GhlCreds> {
  const db = await getServiceSettings<Partial<GhlCreds>>("ghl");
  return {
    apiKey: db?.apiKey ?? process.env.GHL_API_KEY ?? null,
    locationId: db?.locationId ?? process.env.GHL_LOCATION_ID ?? null,
    webhookSecret: db?.webhookSecret ?? process.env.GHL_WEBHOOK_SECRET ?? null,
  };
}

export async function isGhlReady(): Promise<boolean> {
  const c = await getGhlCreds();
  return Boolean(c.apiKey && c.locationId);
}

// ---------------------------------------------------------------------------
// SMTP (configured inside Supabase; we track the guided checklist state)
// ---------------------------------------------------------------------------

export async function isSmtpMarkedDone(): Promise<boolean> {
  const db = await getServiceSettings<{ done?: boolean }>("smtp");
  return Boolean(db?.done);
}
