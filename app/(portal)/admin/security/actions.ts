"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Enrolling and removing an admin's TOTP factor (Matt, 2026-08-19).
 *
 * Everything here acts on the SIGNED-IN admin's own account. There is
 * deliberately no way for one admin to enrol or remove a factor for
 * another: a second factor an administrator can strip from someone else's
 * account is not a second factor, it is a formality.
 */

export interface EnrollStart {
  ok: boolean;
  message?: string;
  factorId?: string;
  /** SVG QR code from Supabase, for an authenticator that scans. */
  qr?: string;
  /** The same secret in text, for pasting into 1Password by hand. */
  secret?: string;
}

export async function startMfaEnrollment(): Promise<EnrollStart> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Preview mode — nothing to enrol." };
  }
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const supabase = await createClient();

  /*
   * An abandoned enrolment leaves an UNVERIFIED factor behind, and Supabase
   * refuses a second one with the same friendly name. Clear those first, or
   * a single mistyped code makes the button permanently useless.
   */
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const factor of existing?.all ?? []) {
    if (factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Momentum+ admin",
  });
  if (error || !data) {
    return { ok: false, message: error?.message ?? "Couldn't start enrolment." };
  }
  return {
    ok: true,
    factorId: data.id,
    qr: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

/**
 * Confirm the code, which both proves the secret was stored correctly and
 * raises this session to aal2.
 */
export async function confirmMfaEnrollment(
  factorId: string,
  code: string,
): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Preview mode." };
  }
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.message ?? "Not allowed." };

  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6) {
    return { ok: false, message: "Enter the six digits from your authenticator." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: clean,
  });
  if (error) {
    /*
     * Almost always a clock or a typo, and "invalid" alone sends people
     * hunting for the wrong thing. TOTP codes are derived from the time,
     * so a device a minute out fails every code it shows.
     */
    return {
      ok: false,
      message:
        "That code didn't match. It changes every 30 seconds — try the current one, and check the device's clock is set automatically.",
    };
  }
  revalidatePath("/admin/security");
  return {
    ok: true,
    message:
      "Two-factor is on. From now on this account needs a code after the password — including on a new browser.",
  };
}

/**
 * Remove a factor. Requires a current code, so possession of the session
 * alone is not enough to take the protection off.
 */
export async function disableMfa(
  factorId: string,
  code: string,
): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Preview mode." };
  }
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.message ?? "Not allowed." };

  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6) {
    return { ok: false, message: "Enter a current code to turn this off." };
  }

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: clean,
  });
  if (verifyError) {
    return { ok: false, message: "That code didn't match, so nothing changed." };
  }
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/security");
  return {
    ok: true,
    message: "Two-factor is off. This account is back to a password alone.",
  };
}
