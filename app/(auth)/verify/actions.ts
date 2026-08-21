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

/* --- Passkey (Matt, 2026-08-21) --------------------------------------- */

/**
 * Is there a passkey on this account, and what does the browser need?
 *
 * Returned as JSON options rather than performed here, because the
 * ceremony belongs to the browser: the server can only issue the challenge
 * and check what comes back.
 */
export async function startPasskeyVerification(): Promise<{
  ok: boolean;
  message?: string;
  factorId?: string;
  challengeId?: string;
  options?: unknown;
}> {
  if (!isSupabaseConfigured()) return { ok: false, message: "Preview mode." };

  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const passkey = (factors?.all ?? []).find(
    (f) =>
      (f as { factor_type?: string }).factor_type === "webauthn" &&
      f.status === "verified",
  );
  // No passkey is not an error — the page just offers the code instead.
  if (!passkey) return { ok: false };

  const { requestSiteUrl } = await import("@/lib/site-url");
  const url = await requestSiteUrl();
  let rpId: string | null = null;
  try {
    rpId = url ? new URL(url).hostname : null;
  } catch {
    rpId = null;
  }
  if (!rpId) return { ok: false, message: "Can't resolve the site domain." };

  const { data, error } = await supabase.auth.mfa.challenge({
    factorId: passkey.id,
    webauthn: { rpId },
  });
  if (error || !data) {
    return { ok: false, message: error?.message ?? "Couldn't start." };
  }
  const webauthn = (data as { webauthn?: { credential_options?: unknown } }).webauthn;
  return {
    ok: true,
    factorId: passkey.id,
    challengeId: data.id,
    options: (webauthn?.credential_options as { publicKey?: unknown })?.publicKey,
  };
}

/** Finish signing in with the passkey. */
export async function verifyPasskey(
  factorId: string,
  challengeId: string,
  credential: unknown,
  redirectTo: string,
): Promise<{ ok: boolean; message: string; redirectTo?: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Not available in preview mode." };
  }
  const safeRedirect =
    redirectTo.startsWith("/") && !redirectTo.startsWith("//")
      ? redirectTo
      : "/admin";

  const { requestSiteUrl } = await import("@/lib/site-url");
  const url = await requestSiteUrl();
  let rpId: string | null = null;
  try {
    rpId = url ? new URL(url).hostname : null;
  } catch {
    rpId = null;
  }
  if (!rpId) return { ok: false, message: "Can't resolve the site domain." };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId,
    // 'request' here, not 'create': this is an assertion against a passkey
    // that already exists, where enrolment registers a new one.
    webauthn: { rpId, type: "request", credential_response: credential as never },
  });
  if (error) {
    return {
      ok: false,
      message:
        "That passkey didn't verify. Try again, or use your authenticator code below.",
    };
  }
  return { ok: true, message: "", redirectTo: safeRedirect };
}
