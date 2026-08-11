"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  agreementIsCurrent,
  agreementRequired,
  canonicalAgreementText,
} from "@/lib/advisor-agreement";
import { getAgreementForSpeaker } from "@/lib/agreement-doc-db";
import {
  getSpeakerForUser,
  latestAdvisorAgreement,
} from "@/lib/speaker-tools";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Signing the Momentum+ Leadership Advisor Agreement.
 *
 * This is the only write path into advisor_agreements: the table carries no
 * insert policy at all (migration 0083), so a member cannot POST a signature
 * row at PostgREST with someone else's name on it. Everything that decides
 * WHOSE signature this is — the speaker row, the account behind it, whether
 * they even have to sign — is resolved here from the session cookie, never
 * from the submitted form.
 */

export interface SignResult {
  ok: boolean;
  message?: string;
}

/** Free-text fields are capped so a paste-bomb can't land in the ledger. */
const MAX_FIELD = 200;

function clean(value: FormDataEntryValue | null): string {
  return String(value ?? "")
    .trim()
    .slice(0, MAX_FIELD);
}

/** "" for an empty optional field, so it stores as NULL rather than "". */
function optional(value: FormDataEntryValue | null): string | null {
  return clean(value) || null;
}

/** A date input gives "YYYY-MM-DD" or nothing. Anything else is dropped. */
function optionalDate(value: FormDataEntryValue | null): string | null {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export async function signAdvisorAgreement(
  formData: FormData,
): Promise<SignResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Signed (preview mode)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const speaker = await getSpeakerForUser(user.id);
  if (!speaker) {
    return { ok: false, message: "No active speaker profile on this account." };
  }

  /*
   * A TSLS Main Speaker or a waived speaker has no agreement to sign — §1
   * makes the Advisor role explicitly distinct from a mainstage speaker
   * role. Refuse rather than quietly filing a signature nobody asked for.
   */
  if (!agreementRequired(speaker)) {
    return {
      ok: false,
      message: "This agreement isn't required for your speaker profile.",
    };
  }

  // Already signed this exact version: succeed without adding a second row.
  // A double-submit or a stale tab shouldn't produce two signatures.
  /*
   * Which wording THIS Advisor is being asked to sign — the published
   * master with any per-speaker overrides applied (migration 0086). Both the
   * duplicate check and the stored hash have to use it: an Advisor with an
   * overridden clause signs different words from everyone else, and the
   * record has to say so.
   */
  const { doc, currency } = await getAgreementForSpeaker(speaker.id);

  const existing = await latestAdvisorAgreement(speaker.id);
  if (agreementIsCurrent(existing, currency)) {
    return { ok: true, message: "You've already signed this agreement." };
  }

  const advisorName = clean(formData.get("advisorName"));
  const signedName = clean(formData.get("signedName"));
  if (!advisorName) return { ok: false, message: "Enter your name." };
  if (!signedName) {
    return { ok: false, message: "Type your name in the signature box to sign." };
  }
  if (formData.get("accepted") !== "on") {
    return {
      ok: false,
      message: "Tick the acknowledgement above the signature box to sign.",
    };
  }

  const organization = optional(formData.get("organization"));
  const phone = optional(formData.get("phone"));
  const sessionDate = optionalDate(formData.get("featuredSessionDate"));
  const sessionTime = optional(formData.get("featuredSessionTime"));

  /*
   * The evidentiary bits. Effective Date is the date the Advisor signs, not
   * a field they fill: the document leaves it blank for SLC, and a
   * self-declared effective date on a self-service form is worth less than
   * the timestamp the server can actually vouch for.
   */
  const head = await headers();
  const signedIp =
    head.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    head.get("x-real-ip") ||
    null;
  const signedUserAgent = head.get("user-agent")?.slice(0, MAX_FIELD) ?? null;
  const effectiveDate = new Date().toISOString().slice(0, 10);

  const admin = createServiceClient();
  const { error } = await admin.from("advisor_agreements").insert({
    speaker_id: speaker.id,
    profile_id: user.id,
    agreement_version: currency.version,
    // The exact wording they read, not just the label it was filed under.
    agreement_sha256: createHash("sha256")
      .update(canonicalAgreementText(doc))
      .digest("hex"),
    signed_name: signedName,
    advisor_name: advisorName,
    organization,
    email: user.email ?? null,
    phone,
    effective_date: effectiveDate,
    // Assigned by an admin — read-only on the form, snapshotted here so the
    // record shows the month as it stood when they agreed to it.
    featured_month: speaker.speakerMonth,
    featured_session_date: sessionDate,
    featured_session_time: sessionTime,
    signed_ip: signedIp,
    signed_user_agent: signedUserAgent,
  });
  if (error) {
    // The table arrives with 0083; say so plainly instead of leaking SQL.
    return {
      ok: false,
      message:
        "Couldn't record the signature. If this keeps happening, tell the Momentum+ team — the agreement table may not be set up yet.",
    };
  }

  /*
   * Mirror the living fields onto the speaker row. The snapshot above is
   * what was agreed to and never changes; these are the working values the
   * rest of the platform reads, and §2 expects them to move.
   */
  const { error: speakerError } = await admin
    .from("speakers")
    .update({
      name: advisorName,
      organization,
      featured_session_date: sessionDate,
      featured_session_time: sessionTime,
    })
    .eq("id", speaker.id);
  // A failed mirror is not a failed signature — the ledger row is the thing
  // that matters, and an admin can fix the profile fields. Don't tell the
  // Advisor their signature failed when it didn't.
  if (speakerError) {
    revalidatePath("/speaker");
    return {
      ok: true,
      message:
        "Agreement signed. Some profile details didn't save — check them in your Studio.",
    };
  }

  revalidatePath("/speaker");
  revalidatePath("/speaker/agreement");
  revalidatePath("/speakers");
  return { ok: true, message: "Agreement signed." };
}
