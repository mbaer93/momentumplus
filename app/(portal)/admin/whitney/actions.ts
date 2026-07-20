"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { storeWhitneyPrompt } from "@/lib/whitney";

export interface WhitneyAdminResult {
  ok: boolean;
  message?: string;
}

/**
 * Save the Whitney system-prompt override. An empty prompt clears the
 * override and returns Whitney to the built-in (frozen) instruction set.
 */
export async function saveWhitneyPromptOverride(
  prompt: string,
): Promise<WhitneyAdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };

  try {
    await storeWhitneyPrompt(prompt);
  } catch {
    return {
      ok: false,
      message: "That didn't save — refresh this page and try again (the app may have just been updated).",
    };
  }
  return {
    ok: true,
    message: prompt.trim()
      ? "Whitney's instructions updated — new conversations use them immediately."
      : "Override cleared — Whitney is back on the built-in instructions.",
  };
}
