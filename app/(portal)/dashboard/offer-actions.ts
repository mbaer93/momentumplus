"use server";

import { revalidatePath } from "next/cache";
import { getAuthUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Member closes an offer banner. Their own row only — the id comes from the
 * signed-in user, never from the client, so nobody can dismiss an offer on
 * someone else's behalf.
 */
export async function dismissOffer(offerId: string): Promise<{ ok: boolean }> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: true };
  }
  const user = await getAuthUser();
  if (!user) return { ok: false };

  const { error } = await createServiceClient()
    .from("offer_dismissals")
    .upsert(
      { offer_id: offerId, profile_id: user.id },
      { onConflict: "offer_id,profile_id", ignoreDuplicates: true },
    );
  if (error) return { ok: false };
  revalidatePath("/dashboard");
  return { ok: true };
}
