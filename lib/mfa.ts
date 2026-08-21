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

/*
 * A passkey counts too (Matt, 2026-08-21: "can we switch this to a passkey
 * with 1Password rather than an otp?").
 *
 * Added ALONGSIDE TOTP rather than replacing it, deliberately. A passkey is
 * bound to momentumplus.co, so it cannot be exercised on a preview URL; and
 * losing it means break-glass is deleting the factor row in the database,
 * where losing a TOTP secret means re-adding it from 1Password. Two
 * enrolled factors means either one gets you in.
 *
 * Nothing above this line changed: both are MFA factors, both raise the
 * session to aal2, so mustVerify and every gate keying off it are already
 * factor-agnostic.
 */

/** Verified factors of one kind on this account, for the Security page. */
export interface MfaFactorRow {
  id: string;
  friendlyName: string | null;
  createdAt: string;
}

async function listFactorsOfType(kind: "totp" | "webauthn"): Promise<MfaFactorRow[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return [];
  /*
   * listFactors() types `totp` and `phone` explicitly; webauthn is read off
   * `all` and filtered, so a client whose typings predate passkeys still
   * compiles and simply finds none.
   */
  const all = (data.all ?? []) as {
    id: string;
    factor_type: string;
    status: string;
    friendly_name?: string | null;
    created_at: string;
  }[];
  return all
    .filter((f) => f.factor_type === kind && f.status === "verified")
    .map((f) => ({
      id: f.id,
      friendlyName: f.friendly_name ?? null,
      createdAt: f.created_at,
    }));
}

export async function listTotpFactors(): Promise<MfaFactorRow[]> {
  return listFactorsOfType("totp");
}

/** Verified passkeys on this account. */
export async function listPasskeyFactors(): Promise<MfaFactorRow[]> {
  return listFactorsOfType("webauthn");
}
