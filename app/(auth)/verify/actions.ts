"use server";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Verifying the second factor. Deliberately thin: Supabase owns the
 * checking, and this raises the session's assurance level to aal2 so the
 * admin gate lets it through.
 */
export async function verifySecondFactor(
  code: string,
  redirectTo: string,
): Promise<{ ok: boolean; message: string; redirectTo?: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Not available in preview mode." };
  }
  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6) {
    return { ok: false, message: "Enter the six digits from your authenticator." };
  }
  const safeRedirect =
    redirectTo.startsWith("/") && !redirectTo.startsWith("//")
      ? redirectTo
      : "/admin";

  const supabase = await createClient();
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { ok: false, message: "Couldn't reach the authenticator service — try again." };

  const factor = (factors?.totp ?? [])[0];
  if (!factor) {
    // No factor to verify: nothing is gating this session.
    return { ok: true, message: "", redirectTo: safeRedirect };
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: clean,
  });
  if (error) {
    return {
      ok: false,
      message:
        "That code didn't match. It changes every 30 seconds — try the current one, and check your device's clock is set automatically.",
    };
  }
  return { ok: true, message: "", redirectTo: safeRedirect };
}
