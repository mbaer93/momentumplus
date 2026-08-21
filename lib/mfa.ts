import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requestCache } from "@/lib/request-cache";

/*
 * Two-factor authentication for admins (Matt, 2026-08-19).
 *
 * A Super Admin can read every member's email and phone number, and can
 * mint a link that signs them in AS any member. Until now the only thing
 * standing in front of all that was one password — the same protection a
 * member's account gets, on the account that can reach every member's.
 * OWASP treats a second factor as optional for ordinary users and required
 * for privileged access; this is that.
 *
 * TOTP, so it lives in 1Password alongside the password rather than on a
 * phone that can be lost separately.
 *
 * THE GATE ONLY BITES ONCE A FACTOR EXISTS. Requiring a factor nobody has
 * enrolled yet would lock the only admin out of the tool he would use to
 * fix it, so enrolment comes first and enforcement follows from it. The
 * cost of that ordering is that an admin who never enrols is never
 * protected — which is why Admin → Security says so plainly, rather than
 * leaving it as an option someone forgets.
 *
 * PASSKEYS: built, then removed the same day (Matt, 2026-08-21). The client
 * accepts factorType "webauthn" and the code worked, but this project's
 * Supabase → Authentication → Multi-Factor page offers only TOTP and Phone,
 * so every enrolment came back "MFA enroll is disabled for WebAuthn" and the
 * Security page carried a permanent red error. (The separate Passkeys (BETA)
 * page is passwordless SIGN-IN — a different feature, not a second factor.)
 * A security page that always looks broken teaches people to ignore errors
 * there, so the card came out. The whole implementation — enrolment,
 * verification, the base64url ⇄ ArrayBuffer encoding, and its tests — is in
 * PR #272 and can be restored wholesale the day the toggle appears. Nothing
 * below this line assumes a factor type; the gate reads the assurance level,
 * so a passkey would count the moment one could exist.
 */

export type Aal = "aal1" | "aal2";

export interface MfaStatus {
  /** A verified TOTP factor exists on this account. */
  enrolled: boolean;
  /** The level this session actually holds. */
  current: Aal | null;
  /** The level this account COULD hold — aal2 once a factor is verified. */
  next: Aal | null;
  /** Enrolled, but this session has not yet passed the second factor. */
  mustVerify: boolean;
}

const OFF: MfaStatus = {
  enrolled: false,
  current: null,
  next: null,
  mustVerify: false,
};

/**
 * Where this session stands on two-factor.
 *
 * Per request, because the admin layout, the page, and any action inside
 * it would otherwise each ask Supabase the same question.
 */
export const mfaStatus = requestCache(async (): Promise<MfaStatus> => {
  if (!isSupabaseConfigured()) return OFF;
  const supabase = await createClient();

  const { data: aal, error: aalError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError || !aal) return OFF;

  const current = (aal.currentLevel as Aal | null) ?? null;
  const next = (aal.nextLevel as Aal | null) ?? null;

  /*
   * nextLevel is aal2 exactly when a verified factor exists, so it answers
   * "enrolled?" without a second round trip. mustVerify is the gap between
   * what the account requires and what this session has — the state an
   * admin is in between signing in and entering their code.
   */
  return {
    enrolled: next === "aal2",
    current,
    next,
    mustVerify: next === "aal2" && current === "aal1",
  };
});

/** Verified TOTP factors on this account, for the Security page. */
export async function listTotpFactors(): Promise<
  { id: string; friendlyName: string | null; createdAt: string }[]
> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return [];
  return (data.totp ?? []).map((f) => ({
    id: f.id,
    friendlyName: f.friendly_name ?? null,
    createdAt: f.created_at,
  }));
}
