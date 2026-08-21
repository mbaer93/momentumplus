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

/* --- Passkeys (Matt, 2026-08-21) -------------------------------------- */

/**
 * The Relying Party ID for the WebAuthn ceremony: the bare hostname.
 *
 * Derived from the live request, never a constant. A passkey is BOUND to
 * this value — one created on momentumplus.co cannot be used anywhere
 * else, which is the property that makes passkeys phishing-resistant and
 * also the reason a preview URL cannot exercise one. Hardcoding the
 * production domain would make enrolment silently fail everywhere else
 * with the browser's uninformative NotAllowedError.
 */
async function relyingPartyId(): Promise<string | null> {
  const { requestSiteUrl } = await import("@/lib/site-url");
  const url = await requestSiteUrl();
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export interface PasskeyStart {
  ok: boolean;
  message?: string;
  factorId?: string;
  challengeId?: string;
  /** PublicKeyCredentialCreationOptions, still JSON — the browser decodes. */
  options?: unknown;
}

/**
 * Begin enrolling a passkey.
 *
 * Two round trips by necessity: WebAuthn lives in the browser, so the
 * server can only hand over the options and take the credential back.
 * enroll() creates the unverified factor, challenge() produces the
 * creation options, and the client does the ceremony in between.
 */
export async function startPasskeyEnrollment(): Promise<PasskeyStart> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Preview mode — nothing to enrol." };
  }
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const supabase = await createClient();

  // Same housekeeping as TOTP: an abandoned attempt leaves an unverified
  // factor behind, and it would block the next one.
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const factor of existing?.all ?? []) {
    if (factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "webauthn",
    friendlyName: `Passkey ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error || !data) {
    return {
      ok: false,
      message:
        error?.message ??
        "Couldn't start. If this says the factor type is unsupported, enable Passkeys in Supabase → Authentication.",
    };
  }

  const rpId = await relyingPartyId();
  if (!rpId) {
    return {
      ok: false,
      message:
        "Can't tell which domain to bind the passkey to. Set NEXT_PUBLIC_SITE_URL, or enrol from the real site rather than a preview URL.",
    };
  }

  const challenge = await supabase.auth.mfa.challenge({
    factorId: data.id,
    webauthn: { rpId },
  });
  if (challenge.error || !challenge.data) {
    return { ok: false, message: challenge.error?.message ?? "Couldn't start." };
  }
  const webauthn = (challenge.data as { webauthn?: { credential_options?: unknown } })
    .webauthn;
  return {
    ok: true,
    factorId: data.id,
    challengeId: challenge.data.id,
    options: (webauthn?.credential_options as { publicKey?: unknown })?.publicKey,
  };
}

/** Finish enrolling — the credential the authenticator produced. */
export async function confirmPasskeyEnrollment(
  factorId: string,
  challengeId: string,
  credential: unknown,
): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseConfigured()) return { ok: true, message: "Preview mode." };
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const rpId = await relyingPartyId();
  if (!rpId) return { ok: false, message: "Can't resolve the site domain." };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId,
    webauthn: {
      rpId,
      type: "create",
      // The field is credential_response, not `credential` — the types say
      // so, and sending the wrong key fails with a generic server error.
      credential_response: credential as never,
    },
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/security");
  return {
    ok: true,
    message:
      "Passkey added. Your authenticator code still works as a fallback — keep it.",
  };
}

/**
 * Remove a passkey.
 *
 * Unlike disabling TOTP this needs no fresh proof, because Supabase already
 * requires an aal2 session to unenroll a verified factor — and reaching
 * this page at all means passing one. Removing the LAST factor is what
 * matters, and the UI warns before that.
 */
export async function removePasskey(factorId: string): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseConfigured()) return { ok: true, message: "Preview mode." };
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/security");
  return { ok: true, message: "Passkey removed." };
}
