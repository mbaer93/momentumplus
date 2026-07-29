import { createServiceClient } from "@/lib/supabase/admin";

/*
 * Sponsor-email master switch (Matt, 2026-07-29): "I don't want any emails
 * going out to sponsors yet from either platform." Every flow that would
 * email a sponsor (rep invites, team welcome emails) checks this first.
 * DEFAULT IS OFF — a missing setting means paused — so nothing reaches a
 * sponsor until Matt flips it on in Admin → Sponsors.
 */

const KEY = "sponsor_emails";

export async function sponsorEmailsEnabled(): Promise<boolean> {
  try {
    const { data } = await createServiceClient()
      .from("app_settings")
      .select("value")
      .eq("key", KEY)
      .maybeSingle();
    return (data?.value as { enabled?: boolean } | null)?.enabled === true;
  } catch {
    return false;
  }
}

export async function setSponsorEmailsEnabled(
  enabled: boolean,
): Promise<{ error: string | null }> {
  const { error } = await createServiceClient()
    .from("app_settings")
    .upsert(
      { key: KEY, value: { enabled }, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  return { error: error?.message ?? null };
}
