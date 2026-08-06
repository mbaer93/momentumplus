import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/* Editable A2A page description (Matt, 2026-08-06: "I cannot change the
   description on the main A2A page - please make it editable"). Stored in
   app_settings; the default below is the copy Matt supplied. */

export const ASPIRE_COPY_KEY = "aspire_page_copy";

export const ASPIRE_COPY_DEFAULT = `Aspire2Achieve (A2A) Growth is a monthly implementation and accountability session designed to help Momentum+ members stay focused on what matters most. Each session provides an opportunity to celebrate progress, work through challenges, exchange ideas with fellow leaders, and leave with clear action steps for the month ahead.

Each month, join a 45-minute live implementation session to maintain momentum, strengthen accountability, and continue making meaningful progress alongside a community committed to growth. No signup required—just show up.`;

export async function readAspireCopy(): Promise<string> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return ASPIRE_COPY_DEFAULT;
  }
  try {
    const admin = createServiceClient();
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", ASPIRE_COPY_KEY)
      .maybeSingle();
    const text = (data?.value as { text?: string } | null)?.text;
    return text?.trim() ? text : ASPIRE_COPY_DEFAULT;
  } catch {
    return ASPIRE_COPY_DEFAULT;
  }
}
