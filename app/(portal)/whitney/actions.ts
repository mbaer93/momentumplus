"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/** Delete one of the member's own Whitney conversations (and its messages). */
export async function deleteWhitneyConversation(
  conversationId: string,
): Promise<{ ok: boolean; message?: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Deleted (preview mode)." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const admin = createServiceClient();
  const { data: conv } = await admin
    .from("whitney_conversations")
    .select("id, profile_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv || conv.profile_id !== user.id) {
    return { ok: false, message: "That conversation isn't yours." };
  }
  const { error } = await admin
    .from("whitney_conversations")
    .delete()
    .eq("id", conversationId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/whitney");
  return { ok: true };
}
